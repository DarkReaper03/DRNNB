# DRNNB Aka Dark Reaper Nickname Block

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2.svg)](https://discord.js.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

A lightweight Discord bot that lets admins **set and lock member nicknames**. Once a
member is locked, any nickname they set via their per-server profile is instantly
reverted back to the enforced name. All commands are **Administrator-only**.

## Features

- 🔒 Lock a member to a fixed nickname they can't change
- ✏️ Set, change, or release enforced nicknames with slash commands
- ♻️ Automatically reverts unauthorized nickname edits in real time
- 💾 Locks persist across restarts (saved to `locks.json`)
- 🛡️ Every command is restricted to admins via Discord's built-in permissions

## Commands

| Command | What it does |
| --- | --- |
| `/setnickname user:@member name:<text>` | Sets the member's nickname **and** locks it. |
| `/changenickname user:@member name:<text>` | Changes the enforced nickname of a locked member. |
| `/blocknickname user:@member` | Locks the member at their **current** nickname. |
| `/unblocknickname user:@member` | Releases the lock so they can change it again. |
| `/lockedlist` | Lists all currently locked members. |

Only members with the **Administrator** permission can see or run these commands.

## Prerequisites

- [Node.js](https://nodejs.org) **v18 or newer** (v24 LTS recommended)
- A Discord application with a bot token — created at the
  [Discord Developer Portal](https://discord.com/developers/applications)

## Installation

```bash
git clone https://github.com/DarkReaper03/DRNNB.git
cd DRNNB
npm install
```

## Configuration

1. **Create the bot application**
   - Go to the [Developer Portal](https://discord.com/developers/applications) → **New Application**.
   - Open **Bot** → **Reset Token** → copy the token.
   - Under **Bot**, enable the **Server Members Intent** (required — enforcement
     won't work without it).

2. **Set your environment variables** — copy `.env.example` to `.env` and fill it in:

   ```bash
   cp .env.example .env
   ```

   ```
   DISCORD_TOKEN=your bot token
   CLIENT_ID=your application id (General Information page)
   GUILD_ID=your server id (right-click the server -> Copy Server ID)
   ```

   > Enable **Developer Mode** (User Settings → Advanced) to copy IDs by right-clicking.
   >
   > `.env` is git-ignored — never commit it.

3. **Invite the bot** to your server. On the Developer Portal go to
   **OAuth2 → URL Generator**, tick `bot` and `applications.commands`, then under
   **Bot Permissions** tick **Manage Nicknames**. Open the generated URL and add
   the bot to your server.

## Usage

```bash
npm start
```

Slash commands register automatically on startup (instantly for the configured
`GUILD_ID`). You should see the bot come online and a "Registered commands" log line.

## How it works

The bot listens for the `guildMemberUpdate` event. When a **locked** member's
nickname changes to anything other than their enforced value, the bot calls
`setNickname()` to revert it. Discord doesn't allow a bot to *block* an edit
outright, so there may be a brief flicker before the name snaps back. Locked
members are also re-enforced on rejoin (`guildMemberAdd`).

## Limitations (Discord rules, not the bot)

- The bot's **role must be higher** than any member it manages — drag it up in
  **Server Settings → Roles**.
- The bot needs the **Manage Nicknames** permission.
- **A bot can never change the server owner's nickname** — a hard Discord
  limitation, so the owner can't be locked.

## Project structure

```
.
├── bot.js          # Main bot: commands + enforcement
├── .env.example    # Template for your environment variables
├── package.json
└── locks.json      # Auto-generated store of locked members (git-ignored)
```

## License

Released under the [MIT License](#license). Free to use, modify, and distribute.
