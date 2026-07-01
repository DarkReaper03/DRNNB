const fs = require('fs')
const path = require('path')
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
  REST,
  Routes,
  MessageFlags,
} = require('discord.js')

require('dotenv').config()

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
}

for (const key of ['token', 'clientId', 'guildId']) {
  if (!config[key]) {
    console.error(`Missing ${key} — set it in your .env file (see .env.example).`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Persistence: locked nicknames, stored as { [guildId]: { [userId]: nick } }
// nick is the enforced name; null means "no nickname" (reset to username).
// ---------------------------------------------------------------------------
const LOCKS_FILE = path.join(__dirname, 'locks.json')

function loadLocks() {
  try {
    return JSON.parse(fs.readFileSync(LOCKS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveLocks() {
  fs.writeFileSync(LOCKS_FILE, JSON.stringify(locks, null, 2))
}

function getLock(guildId, userId) {
  return locks[guildId]?.[userId]
}

function isLocked(guildId, userId) {
  return Boolean(locks[guildId]) && userId in locks[guildId]
}

function setLock(guildId, userId, nick) {
  if (!locks[guildId]) locks[guildId] = {}
  locks[guildId][userId] = nick
  saveLocks()
}

function removeLock(guildId, userId) {
  if (locks[guildId]) {
    delete locks[guildId][userId]
    if (Object.keys(locks[guildId]).length === 0) delete locks[guildId]
    saveLocks()
  }
}

const locks = loadLocks()

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)
}

// ---------------------------------------------------------------------------
// Slash command definitions (all admin-only via default member permissions)
// ---------------------------------------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('setnickname')
    .setDescription('Set a member\'s nickname and lock it so they cannot change it')
    .addUserOption(o =>
      o.setName('user').setDescription('The member to set').setRequired(true))
    .addStringOption(o =>
      o.setName('name').setDescription('The nickname to enforce').setRequired(true).setMaxLength(32))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('changenickname')
    .setDescription('Change the enforced nickname of a locked member')
    .addUserOption(o =>
      o.setName('user').setDescription('The member to change').setRequired(true))
    .addStringOption(o =>
      o.setName('name').setDescription('The new nickname to enforce').setRequired(true).setMaxLength(32))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('blocknickname')
    .setDescription('Lock a member at their current nickname so they cannot change it')
    .addUserOption(o =>
      o.setName('user').setDescription('The member to block').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('unblocknickname')
    .setDescription('Release a member so they can change their nickname again')
    .addUserOption(o =>
      o.setName('user').setDescription('The member to unblock').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('lockedlist')
    .setDescription('List every member whose nickname is currently locked')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
].map(c => c.toJSON())

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
})

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token)
  if (config.guildId) {
    // Guild commands update instantly — best for a single server.
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands },
    )
    log(`Registered ${commands.length} guild commands.`)
  } else {
    // Global commands work everywhere but can take up to an hour to appear.
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands })
    log(`Registered ${commands.length} global commands.`)
  }
}

client.once('clientReady', async () => {
  log(`Logged in as ${client.user.tag}`)
  try {
    await registerCommands()
  } catch (err) {
    log(`Failed to register commands: ${err.message}`)
  }
})

// ---------------------------------------------------------------------------
// Command handling
// ---------------------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  if (!interaction.inGuild()) return

  // Defense in depth: default permissions hide these, but re-check anyway.
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'You need the **Administrator** permission to use this command.',
      flags: MessageFlags.Ephemeral,
    })
  }

  const { commandName } = interaction

  if (commandName === 'lockedlist') {
    const guildLocks = locks[interaction.guildId] || {}
    const entries = Object.entries(guildLocks)
    if (entries.length === 0) {
      return interaction.reply({ content: 'No members are currently locked.', flags: MessageFlags.Ephemeral })
    }
    const lines = entries.map(([userId, nick]) =>
      `• <@${userId}> → ${nick === null ? '*(no nickname)*' : `\`${nick}\``}`)
    return interaction.reply({
      content: `**Locked nicknames (${entries.length}):**\n${lines.join('\n')}`,
      flags: MessageFlags.Ephemeral,
    })
  }

  const targetUser = interaction.options.getUser('user')
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null)
  if (!member) {
    return interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral })
  }

  // The bot cannot change the server owner or anyone at/above its own role.
  const needsEdit = commandName === 'setnickname' || commandName === 'changenickname' || commandName === 'blocknickname'
  if (needsEdit && !member.manageable) {
    return interaction.reply({
      content: `I can't manage **${member.user.tag}**'s nickname. Make sure my role is **above** theirs and I have the **Manage Nicknames** permission. (The server owner's nickname can never be changed by a bot.)`,
      flags: MessageFlags.Ephemeral,
    })
  }

  try {
    if (commandName === 'setnickname') {
      const name = interaction.options.getString('name')
      await member.setNickname(name, `Nickname set & locked by ${interaction.user.tag}`)
      setLock(interaction.guildId, member.id, name)
      log(`${interaction.user.tag} set+locked ${member.user.tag} -> "${name}"`)
      return interaction.reply({ content: `Set and locked **${member.user.tag}**'s nickname to \`${name}\`.`, flags: MessageFlags.Ephemeral })
    }

    if (commandName === 'changenickname') {
      const name = interaction.options.getString('name')
      await member.setNickname(name, `Nickname changed by ${interaction.user.tag}`)
      setLock(interaction.guildId, member.id, name)
      log(`${interaction.user.tag} changed ${member.user.tag} -> "${name}"`)
      return interaction.reply({ content: `Changed **${member.user.tag}**'s locked nickname to \`${name}\`.`, flags: MessageFlags.Ephemeral })
    }

    if (commandName === 'blocknickname') {
      const current = member.nickname // null if they have no nickname
      setLock(interaction.guildId, member.id, current)
      log(`${interaction.user.tag} blocked ${member.user.tag} at "${current}"`)
      return interaction.reply({
        content: `Locked **${member.user.tag}** at their current nickname (${current === null ? '*no nickname*' : `\`${current}\``}). They can no longer change it.`,
        flags: MessageFlags.Ephemeral,
      })
    }

    if (commandName === 'unblocknickname') {
      if (!isLocked(interaction.guildId, member.id)) {
        return interaction.reply({ content: `**${member.user.tag}** is not locked.`, flags: MessageFlags.Ephemeral })
      }
      removeLock(interaction.guildId, member.id)
      log(`${interaction.user.tag} unblocked ${member.user.tag}`)
      return interaction.reply({ content: `Unlocked **${member.user.tag}**. They can change their nickname again.`, flags: MessageFlags.Ephemeral })
    }
  } catch (err) {
    log(`Command error (${commandName}): ${err.message}`)
    const reply = { content: `Something went wrong: ${err.message}`, flags: MessageFlags.Ephemeral }
    if (interaction.replied || interaction.deferred) return interaction.followUp(reply)
    return interaction.reply(reply)
  }
})

// ---------------------------------------------------------------------------
// Enforcement: revert nickname changes on locked members.
// When we set the nick back, this fires again but newNick === enforced, so
// the guard below short-circuits and no loop occurs.
// ---------------------------------------------------------------------------
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (!isLocked(newMember.guild.id, newMember.id)) return

  const enforced = getLock(newMember.guild.id, newMember.id)
  const current = newMember.nickname ?? null

  if (current === enforced) return // already correct — nothing to do

  if (!newMember.manageable) {
    log(`Cannot re-enforce nickname for ${newMember.user.tag} (missing permission or role too low).`)
    return
  }

  try {
    await newMember.setNickname(enforced, 'Nickname is locked')
    log(`Reverted ${newMember.user.tag}'s nickname back to ${enforced === null ? '(none)' : `"${enforced}"`}`)
  } catch (err) {
    log(`Failed to revert ${newMember.user.tag}: ${err.message}`)
  }
})

// Keep the enforced name if a locked member leaves and rejoins.
client.on('guildMemberAdd', async (member) => {
  if (!isLocked(member.guild.id, member.id)) return
  const enforced = getLock(member.guild.id, member.id)
  if ((member.nickname ?? null) === enforced) return
  if (!member.manageable) return
  await member.setNickname(enforced, 'Nickname is locked').catch(() => {})
})

client.login(config.token)
