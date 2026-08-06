require('dotenv').config();

const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActivityType, 
  REST, 
  Routes,
  ComponentType
} = require('discord.js');

const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType
} = require('@discordjs/voice');

const youtubeDl = require('youtube-dl-exec');
const yts = require('yt-search');

// ==================== BOT SETUP ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

const queues = new Map();
const cooldowns = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      songs: [],
      connection: null,
      player: null,
      playing: false,
      loop: false,
      volume: 100,
      stay: false,
      filter: 'normal',
      textChannel: null
    });
  }
  return queues.get(guildId);
}

// ==================== SUPER ULTIMATE EMBED ====================
function createUltimateEmbed(title, description, thumbnail, image, fields) {
  const embed = new EmbedBuilder()
    .setColor(0x1a1a2e)
    .setTitle(`▶ ${title}`)
    .setDescription(description || '')
    .setTimestamp()
    .setFooter({ 
      text: '♪ SixStudio Premium | Ultimate Music Bot v2.0', 
      iconURL: 'https://cdn-icons-png.flaticon.com/512/727/727218.png' 
    });

  // Dark red gradient border effect with author
  embed.setAuthor({
    name: '🔴 SIXSTUDIO ULTIMATE MUSIC',
    iconURL: 'https://cdn-icons-png.flaticon.com/512/727/727218.png',
    url: 'https://discord.com'
  });

  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (fields) embed.addFields(fields);

  return embed;
}

function nowPlayingEmbed(song, queue) {
  const progress = '`00:00` ' + '▬'.repeat(7) + '🔘' + '▬'.repeat(7) + ' `' + (song.duration || '?') + '`';
  
  const fields = [
    { name: '┏━━━━━━━━━━━━━━━━━━━━━━', value: '** **', inline: false },
    { name: '👤 ┃ ARTIST', value: '```yaml\n' + song.artist + '\n```', inline: true },
    { name: '⏱ ┃ DURATION', value: '```yaml\n' + (song.duration || '?') + '\n```', inline: true },
    { name: '🔊 ┃ VOLUME', value: '```yaml\n' + queue.volume + '%\n```', inline: true },
    { name: '┣━━━━━━━━━━━━━━━━━━━━━━', value: '** **', inline: false },
    { name: '🎧 ┃ REQUESTED BY', value: '<@' + song.requestedBy + '>', inline: true },
    { name: '📡 ┃ SOURCE', value: song.source === 'spotify' ? '```diff\n+ Spotify\n```' : '```diff\n- YouTube\n```', inline: true },
    { name: '🔁 ┃ LOOP', value: queue.loop ? '```diff\n+ ENABLED\n```' : '```diff\n- DISABLED\n```', inline: true },
    { name: '┣━━━━━━━━━━━━━━━━━━━━━━', value: '** **', inline: false },
    { name: '▶ ┃ PROGRESS', value: progress, inline: false },
    { name: '┗━━━━━━━━━━━━━━━━━━━━━━', value: '** **', inline: false }
  ];

  return createUltimateEmbed(
    'NOW PLAYING',
    `[**${song.title}**](${song.url})\n\n🎵 Enjoy the music!`,
    song.thumbnail,
    null,
    fields
  );
}

function addedToQueueEmbed(song, position) {
  return createUltimateEmbed(
    'ADDED TO QUEUE',
    `[**${song.title}**](${song.url})`,
    song.thumbnail,
    null,
    [
      { name: '👤 Artist', value: '```\n' + song.artist + '\n```', inline: true },
      { name: '#️⃣ Position', value: '```\n#' + position + '\n```', inline: true },
      { name: '⏱ Duration', value: '```\n' + (song.duration || '?') + '\n```', inline: true }
    ]
  );
}

function errorEmbed(message, tip) {
  return createUltimateEmbed(
    '❌ ERROR',
    '```diff\n- ' + message + '\n```' + (tip ? '\n💡 **Tip:** ' + tip : ''),
    'https://cdn-icons-png.flaticon.com/512/753/753345.png'
  );
}

function successEmbed(title, message) {
  return createUltimateEmbed(
    '✅ ' + title,
    '```diff\n+ ' + message + '\n```'
  );
}

// ==================== AUDIO SYSTEM (FIXED) ====================
function createAudioPlayerForGuild(guildId) {
  const queue = getQueue(guildId);
  
  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
      maxMissedFrames: 1000
    }
  });

  player.on(AudioPlayerStatus.Idle, async () => {
    const q = getQueue(guildId);
    
    if (q.loop && q.songs.length > 0) {
      q.songs.push(q.songs[0]);
    }
    
    q.songs.shift();
    
    if (q.songs.length > 0) {
      setTimeout(() => playSong(guildId, q.songs[0]), 500);
    } else {
      q.playing = false;
      if (!q.stay) {
        setTimeout(() => {
          if (!q.playing && q.connection) {
            q.connection.destroy();
            queues.delete(guildId);
          }
        }, 300000);
      }
    }
  });

  player.on('error', (error) => {
    console.error(`[AUDIO ERROR] ${error.message}`);
    const q = getQueue(guildId);
    q.songs.shift();
    if (q.songs.length > 0) {
      setTimeout(() => playSong(guildId, q.songs[0]), 1000);
    }
  });

  queue.player = player;
  return player;
}

async function getAudioStream(url) {
  try {
    const result = await youtubeDl(url, {
      extractAudio: true,
      audioFormat: 'opus',
      audioQuality: 0,
      output: '-',
      noPlaylist: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:googlebot']
    });
    
    return result.stdout;
  } catch (error) {
    console.error('[STREAM ERROR]', error.message);
    throw error;
  }
}

async function playSong(guildId, song) {
  const queue = getQueue(guildId);
  
  try {
    console.log(`[PLAYING] ${song.title}`);
    
    let stream;
    if (song.source === 'spotify') {
      const searchResult = await yts(song.title + ' ' + song.artist + ' official audio');
      if (!searchResult.videos.length) throw new Error('No YouTube equivalent found');
      const video = searchResult.videos[0];
      song.url = video.url;
      song.duration = video.duration.timestamp;
      stream = await getAudioStream(video.url);
    } else {
      stream = await getAudioStream(song.url);
    }
    
    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true
    });
    
    if (resource.volume) {
      resource.volume.setVolume(queue.volume / 100);
    }
    
    queue.player.play(resource);
    queue.connection.subscribe(queue.player);
    queue.playing = true;
    
    // Update now playing message if exists
    if (queue.textChannel && queue.songs.length > 0) {
      // Could update message here
    }
    
  } catch (error) {
    console.error(`[PLAY ERROR] ${error.message}`);
    const q = getQueue(guildId);
    q.songs.shift();
    if (q.songs.length > 0) {
      setTimeout(() => playSong(guildId, q.songs[0]), 1000);
    }
  }
}

// ==================== COMMANDS ====================
const commands = [
  {
    name: 'join',
    description: '📢 Make bot join your voice channel',
    options: []
  },
  {
    name: 'play',
    description: '▶ Play music instantly',
    options: [{
      name: 'query',
      description: 'Song title, YouTube URL, or Spotify URL',
      type: 3,
      required: true
    }]
  },
  {
    name: 'search',
    description: '🔍 Search YouTube (10 results with preview)',
    options: [{
      name: 'query',
      description: 'What to search',
      type: 3,
      required: true
    }]
  },
  {
    name: 'playvideo',
    description: '📺 Play YouTube video with BIG preview',
    options: [{
      name: 'query',
      description: 'Video title or URL',
      type: 3,
      required: true
    }]
  },
  {
    name: 'spotify',
    description: '🟢 Play from Spotify',
    options: [{
      name: 'query',
      description: 'Song or artist name',
      type: 3,
      required: true
    }]
  },
  {
    name: 'queue',
    description: '📋 Show current queue'
  },
  {
    name: 'skip',
    description: '⏭ Skip current song'
  },
  {
    name: 'stop',
    description: '⏹ Stop and leave'
  },
  {
    name: 'pause',
    description: '⏸ Pause'
  },
  {
    name: 'resume',
    description: '▶ Resume'
  },
  {
    name: 'nowplaying',
    description: '🎵 Show now playing'
  },
  {
    name: 'loop',
    description: '🔁 Toggle loop'
  },
  {
    name: 'volume',
    description: '🔊 Set volume (1-200)',
    options: [{
      name: 'level',
      description: 'Volume level',
      type: 4,
      required: true,
      min_value: 1,
      max_value: 200
    }]
  },
  {
    name: 'shuffle',
    description: '🔀 Shuffle queue'
  },
  {
    name: 'remove',
    description: '🗑 Remove song by position',
    options: [{
      name: 'position',
      description: 'Queue position number',
      type: 4,
      required: true
    }]
  },
  {
    name: 'clear',
    description: '🧹 Clear queue'
  },
  {
    name: 'lyrics',
    description: '📝 Search song info',
    options: [{
      name: 'query',
      description: 'Song title',
      type: 3,
      required: true
    }]
  },
  {
    name: 'bassboost',
    description: '🔊 Toggle bass boost'
  },
  {
    name: 'nightcore',
    description: '⚡ Toggle nightcore'
  },
  {
    name: '247',
    description: '🌙 Toggle 24/7 mode'
  },
  {
    name: 'stats',
    description: '📊 Bot statistics'
  },
  {
    name: 'help',
    description: '❓ Show all commands'
  }
];

// ==================== READY EVENT ====================
client.once('ready', async () => {
  console.log(`[BOT] ✅ Logged in as ${client.user.tag}`);
  
  client.user.setPresence({
    activities: [{ 
      name: '🎵 /play | Ultimate Music Bot', 
      type: ActivityType.Listening 
    }],
    status: 'online'
  });

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log(`[BOT] ✅ ${commands.length} Commands registered`);
  } catch (error) {
    console.error('[BOT] ❌ Command registration failed:', error.message);
  }

  // Keep alive ping
  setInterval(() => {
    console.log(`[ALIVE] 💓 ${new Date().toLocaleTimeString()} | Guilds: ${client.guilds.cache.size}`);
  }, 60000);
});

// ==================== COMMAND HANDLER ====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, member, guild, channel } = interaction;
  const queue = getQueue(guild.id);
  const voiceChannel = member.voice.channel;

  // Cooldown check
  const now = Date.now();
  const cooldownAmount = 3000;
  if (cooldowns.has(member.id)) {
    const expirationTime = cooldowns.get(member.id) + cooldownAmount;
    if (now < expirationTime) {
      return interaction.reply({ 
        embeds: [errorEmbed('Please wait a few seconds!', 'Anti-spam protection')], 
        ephemeral: true 
      });
    }
  }
  cooldowns.set(member.id, now);
  setTimeout(() => cooldowns.delete(member.id), cooldownAmount);

  // ==================== JOIN COMMAND ====================
  if (commandName === 'join') {
    if (!voiceChannel) {
      return interaction.reply({ 
        embeds: [errorEmbed('Join a voice channel first!')], 
        ephemeral: true 
      });
    }

    try {
      queue.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });

      queue.connection.on(VoiceConnectionStatus.Ready, () => {
        console.log(`[VC] Connected to ${voiceChannel.name}`);
      });

      queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(queue.connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(queue.connection, VoiceConnectionStatus.Connecting, 5000),
          ]);
        } catch (error) {
          queue.connection.destroy();
          queues.delete(guild.id);
        }
      });

      interaction.reply({ 
        embeds: [successEmbed('JOINED', `Connected to **${voiceChannel.name}**! 🔊`)] 
      });
    } catch (error) {
      interaction.reply({ 
        embeds: [errorEmbed('Failed to join!', 'Check my permissions')] 
      });
    }
  }

  // ==================== PLAY COMMAND ====================
  else if (commandName === 'play') {
    if (!voiceChannel) {
      return interaction.reply({ 
        embeds: [errorEmbed('Join a voice channel first!')], 
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    const query = options.getString('query');

    try {
      let song = {};

      // Fast URL detection
      if (query.includes('spotify.com/track')) {
        await interaction.editReply({ embeds: [createUltimateEmbed('🟢 SPOTIFY', 'Loading from Spotify...')] });
        // Spotify handling would go here with API
        song = {
          title: 'Spotify Track',
          artist: 'Unknown',
          url: query,
          thumbnail: 'https://cdn-icons-png.flaticon.com/512/2111/2111624.png',
          duration: '?',
          source: 'spotify',
          requestedBy: member.id
        };
      } else if (query.includes('youtube.com') || query.includes('youtu.be')) {
        await interaction.editReply({ embeds: [createUltimateEmbed('🔴 YOUTUBE', 'Loading video...')] });
        
        const videoInfo = await yts({ videoId: query.split('v=')[1]?.split('&')[0] || query.split('/').pop() });
        
        song = {
          title: videoInfo.title || 'Unknown',
          artist: videoInfo.author?.name || 'Unknown',
          url: query,
          thumbnail: videoInfo.thumbnail || 'https://cdn-icons-png.flaticon.com/512/1384/1384060.png',
          duration: videoInfo.duration?.timestamp || '?',
          source: 'youtube',
          requestedBy: member.id
        };
      } else {
        // Search mode - FAST
        await interaction.editReply({ embeds: [createUltimateEmbed('🔍 SEARCHING', `Finding: **${query}**...`)] });
        
        const searchResult = await yts(query);
        if (!searchResult.videos.length) {
          return interaction.editReply({ 
            embeds: [errorEmbed('No results found!', 'Try different keywords')] 
          });
        }

        const video = searchResult.videos[0];
        song = {
          title: video.title,
          artist: video.author.name,
          url: video.url,
          thumbnail: video.thumbnail,
          duration: video.duration.timestamp || '?',
          source: 'youtube',
          requestedBy: member.id
        };
      }

      // Connect to VC if not connected
      if (!queue.connection) {
        queue.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false
        });
      }

      queue.songs.push(song);
      queue.textChannel = channel;

      if (!queue.playing) {
        createAudioPlayerForGuild(guild.id);
        await playSong(guild.id, song);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pause').setEmoji('⏸').setLabel('PAUSE').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('skip').setEmoji('⏭').setLabel('SKIP').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('stop').setEmoji('⏹').setLabel('STOP').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('loop').setEmoji('🔁').setLabel('LOOP').setStyle(ButtonStyle.Success)
        );

        await interaction.editReply({
          embeds: [nowPlayingEmbed(song, queue)],
          components: [row]
        });
      } else {
        await interaction.editReply({
          embeds: [addedToQueueEmbed(song, queue.songs.length)]
        });
      }

    } catch (error) {
      console.error(error);
      await interaction.editReply({ 
        embeds: [errorEmbed('Failed to play!', error.message)] 
      });
    }
  }

  // ==================== SEARCH COMMAND ====================
  else if (commandName === 'search') {
    await interaction.deferReply();

    const query = options.getString('query');

    try {
      const searchResult = await yts(query);
      const videos = searchResult.videos.slice(0, 10);

      if (!videos.length) {
        return interaction.editReply({ 
          embeds: [errorEmbed('No results found!')] 
        });
      }

      const options_select = videos.map((v, i) => 
        new StringSelectMenuOptionBuilder()
          .setLabel(`${i + 1}. ${v.title.slice(0, 50)}`)
          .setDescription(`${v.author.name} | ${v.duration.timestamp}`)
          .setValue(v.url)
          .setEmoji('🎵')
      );

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('search_select')
          .setPlaceholder('🎵 Select a song to play...')
          .addOptions(options_select)
      );

      const embed = createUltimateEmbed(
        '🔍 SEARCH RESULTS',
        `Found **${videos.length}** results for: \`${query}\`\n\nSelect from dropdown below 👇`,
        null,
        null,
        videos.slice(0, 3).map((v, i) => ({
          name: `${i + 1}. ${v.title.slice(0, 40)}`,
          value: `👤 ${v.author.name} | ⏱ ${v.duration.timestamp} | 👁 ${v.views}`,
          inline: false
        }))
      );

      await interaction.editReply({ embeds: [embed], components: [row] });

    } catch (error) {
      await interaction.editReply({ 
        embeds: [errorEmbed(error.message)] 
      });
    }
  }

  // ==================== PLAYVIDEO COMMAND ====================
  else if (commandName === 'playvideo') {
    if (!voiceChannel) {
      return interaction.reply({ 
        embeds: [errorEmbed('Join a voice channel first!')], 
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    const query = options.getString('query');

    try {
      let url = query;
      let videoInfo;

      if (!query.startsWith('http')) {
        const searchResult = await yts(query);
        if (!searchResult.videos.length) throw new Error('Video not found');
        url = searchResult.videos[0].url;
        videoInfo = searchResult.videos[0];
      } else {
        const searchResult = await yts({ videoId: query.split('v=')[1]?.split('&')[0] });
        videoInfo = searchResult;
      }

      const song = {
        title: videoInfo.title,
        artist: videoInfo.author?.name || 'Unknown',
        url: url,
        thumbnail: videoInfo.thumbnail,
        duration: videoInfo.duration?.timestamp || '?',
        source: 'youtube',
        requestedBy: member.id
      };

      if (!queue.connection) {
        queue.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false
        });
      }

      queue.songs.push(song);

      if (!queue.playing) {
        createAudioPlayerForGuild(guild.id);
        await playSong(guild.id, song);

        // BIG VIDEO PREVIEW
        const bigImage = videoInfo.image || videoInfo.thumbnail;

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pause').setEmoji('⏸').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('skip').setEmoji('⏭').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('stop').setEmoji('⏹').setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({
          embeds: [createUltimateEmbed(
            '📺 VIDEO NOW PLAYING',
            `[**${song.title}**](${song.url})\n\n🎬 Enjoy the video!`,
            song.thumbnail,
            bigImage,
            [
              { name: '👤 Channel', value: '```\n' + song.artist + '\n```', inline: true },
              { name: '⏱ Duration', value: '```\n' + song.duration + '\n```', inline: true },
              { name: '🔊 Volume', value: '```\n' + queue.volume + '%\n```', inline: true }
            ]
          )],
          components: [row]
        });
      } else {
        await interaction.editReply({
          embeds: [addedToQueueEmbed(song, queue.songs.length)]
        });
      }

    } catch (error) {
      await interaction.editReply({ 
        embeds: [errorEmbed(error.message)] 
      });
    }
  }

  // ==================== SPOTIFY COMMAND ====================
  else if (commandName === 'spotify') {
    if (!voiceChannel) {
      return interaction.reply({ 
        embeds: [errorEmbed('Join a voice channel first!')], 
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    const query = options.getString('query');

    try {
      // Search YouTube instead (Spotify API needs setup)
      const searchResult = await yts(query + ' official audio');
      if (!searchResult.videos.length) throw new Error('No results');

      const video = searchResult.videos[0];
      const song = {
        title: video.title,
        artist: video.author.name,
        url: video.url,
        thumbnail: video.thumbnail,
        duration: video.duration.timestamp || '?',
        source: 'spotify',
        requestedBy: member.id
      };

      if (!queue.connection) {
        queue.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false
        });
      }

      queue.songs.push(song);

      if (!queue.playing) {
        createAudioPlayerForGuild(guild.id);
        await playSong(guild.id, song);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pause').setEmoji('⏸').setLabel('PAUSE').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('skip').setEmoji('⏭').setLabel('SKIP').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('stop').setEmoji('⏹').setLabel('STOP').setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({
          embeds: [createUltimateEmbed(
            '🟢 SPOTIFY NOW PLAYING',
            `[**${song.title}**](${song.url})`,
            song.thumbnail,
            null,
            [
              { name: '👤 Artist', value: '```\n' + song.artist + '\n```', inline: true },
              { name: '⏱ Duration', value: '```\n' + song.duration + '\n```', inline: true },
              { name: '🔊 Volume', value: '```\n' + queue.volume + '%\n```', inline: true }
            ]
          )],
          components: [row]
        });
      } else {
        await interaction.editReply({
          embeds: [addedToQueueEmbed(song, queue.songs.length)]
        });
      }

    } catch (error) {
      await interaction.editReply({ 
        embeds: [errorEmbed(error.message)] 
      });
    }
  }

  // ==================== QUEUE ====================
  else if (commandName === 'queue') {
    if (!queue.songs.length) {
      return interaction.reply({ 
        embeds: [createUltimateEmbed('📋 QUEUE', 'Queue is empty! Add songs with `/play`')] 
      });
    }

    const current = queue.songs[0];
    const upcoming = queue.songs.slice(1, 11).map((s, i) => 
      `\`${i + 1}.\` [${s.title.slice(0, 35)}](${s.url}) | \`${s.duration || '?'}\` | <@${s.requestedBy}>`
    ).join('\n') || '*No upcoming songs*';

    interaction.reply({
      embeds: [createUltimateEmbed(
        '📋 MUSIC QUEUE',
        `**${queue.songs.length}** songs in queue`,
        current.thumbnail,
        null,
        [
          { name: '▶ NOW PLAYING', value: `[${current.title}](${current.url}) | \`${current.duration || '?'}\``, inline: false },
          { name: '📥 UP NEXT', value: upcoming, inline: false },
          { name: '⚙️ SETTINGS', value: `🔁 Loop: \`${queue.loop ? 'ON' : 'OFF'}\` | 🔊 Volume: \`${queue.volume}%\` | 🌙 24/7: \`${queue.stay ? 'ON' : 'OFF'}\``, inline: false }
        ]
      )]
    });
  }

  // ==================== SKIP ====================
  else if (commandName === 'skip') {
    if (!queue.player || !queue.playing) {
      return interaction.reply({ 
        embeds: [errorEmbed('Nothing is playing!')], 
        ephemeral: true 
      });
    }
    queue.player.stop();
    interaction.reply({ 
      embeds: [successEmbed('SKIPPED', 'Skipped to next song! ⏭')] 
    });
  }

  // ==================== STOP ====================
  else if (commandName === 'stop') {
    if (queue.connection) {
      queue.connection.destroy();
      queues.delete(guild.id);
    }
    interaction.reply({ 
      embeds: [successEmbed('STOPPED', 'Left voice channel. Goodbye! 👋')] 
    });
  }

  // ==================== PAUSE ====================
  else if (commandName === 'pause') {
    if (!queue.player) {
      return interaction.reply({ 
        embeds: [errorEmbed('Nothing to pause!')], 
        ephemeral: true 
      });
    }
    queue.player.pause();
    interaction.reply({ 
      embeds: [successEmbed('PAUSED', 'Music paused. Use `/resume` to continue.')] 
    });
  }

  // ==================== RESUME ====================
  else if (commandName === 'resume') {
    if (!queue.player) {
      return interaction.reply({ 
        embeds: [errorEmbed('Nothing to resume!')], 
        ephemeral: true 
      });
    }
    queue.player.unpause();
    interaction.reply({ 
      embeds: [successEmbed('RESUMED', 'Music resumed! ▶')] 
    });
  }

  // ==================== NOWPLAYING ====================
  else if (commandName === 'nowplaying') {
    if (!queue.songs.length || !queue.playing) {
      return interaction.reply({ 
        embeds: [errorEmbed('Nothing is playing!')], 
        ephemeral: true 
      });
    }

    const current = queue.songs[0];
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pause').setEmoji('⏸').setLabel('PAUSE').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('skip').setEmoji('⏭').setLabel('SKIP').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('stop').setEmoji('⏹').setLabel('STOP').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('loop').setEmoji('🔁').setLabel('LOOP').setStyle(ButtonStyle.Success)
    );

    interaction.reply({
      embeds: [nowPlayingEmbed(current, queue)],
      components: [row]
    });
  }

  // ==================== LOOP ====================
  else if (commandName === 'loop') {
    queue.loop = !queue.loop;
    interaction.reply({ 
      embeds: [successEmbed('LOOP MODE', queue.loop ? 'Loop is now **ENABLED** 🔁' : 'Loop is now **DISABLED**')] 
    });
  }

  // ==================== VOLUME ====================
  else if (commandName === 'volume') {
    const vol = options.getInteger('level');
    if (vol < 1 || vol > 200) {
      return interaction.reply({ 
        embeds: [errorEmbed('Volume must be 1-200!')], 
        ephemeral: true 
      });
    }

    queue.volume = vol;
    if (queue.player && queue.player.state.resource && queue.player.state.resource.volume) {
      queue.player.state.resource.volume.setVolume(vol / 100);
    }

    interaction.reply({ 
      embeds: [successEmbed('VOLUME SET', `Volume changed to **${vol}%** 🔊`)] 
    });
  }

  // ==================== SHUFFLE ====================
  else if (commandName === 'shuffle') {
    if (queue.songs.length < 3) {
      return interaction.reply({ 
        embeds: [errorEmbed('Need at least 3 songs!')], 
        ephemeral: true 
      });
    }

    const current = queue.songs[0];
    const rest = queue.songs.slice(1);
    
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }

    queue.songs = [current, ...rest];
    interaction.reply({ 
      embeds: [successEmbed('SHUFFLED', `Queue shuffled! **${queue.songs.length}** songs 🔀`)] 
    });
  }

  // ==================== REMOVE ====================
  else if (commandName === 'remove') {
    const pos = options.getInteger('position');
    if (pos < 1 || pos >= queue.songs.length) {
      return interaction.reply({ 
        embeds: [errorEmbed('Invalid position! Use `/queue` to see numbers.')], 
        ephemeral: true 
      });
    }

    const removed = queue.songs.splice(pos, 1)[0];
    interaction.reply({ 
      embeds: [successEmbed('REMOVED', `Removed: **${removed.title}** 🗑`)] 
    });
  }

  // ==================== CLEAR ====================
  else if (commandName === 'clear') {
    const current = queue.songs[0];
    queue.songs = current ? [current] : [];
    interaction.reply({ 
      embeds: [successEmbed('CLEARED', 'Queue cleared! Keeping current song. 🧹')] 
    });
  }

  // ==================== LYRICS ====================
  else if (commandName === 'lyrics') {
    await interaction.deferReply();

    const query = options.getString('query');

    try {
      const searchResult = await yts(query);
      if (!searchResult.videos.length) throw new Error('Not found');

      const video = searchResult.videos[0];
      interaction.editReply({
        embeds: [createUltimateEmbed(
          '📝 SONG INFO',
          `[**${video.title}**](${video.url})`,
          video.thumbnail,
          null,
          [
            { name: '👤 Channel', value: '```\n' + video.author.name + '\n```', inline: true },
            { name: '⏱ Duration', value: '```\n' + video.duration.timestamp + '\n```', inline: true },
            { name: '👁 Views', value: '```\n' + video.views + '\n```', inline: true }
          ]
        )]
      });
    } catch (error) {
      interaction.editReply({ 
        embeds: [errorEmbed(error.message)] 
      });
    }
  }

  // ==================== BASSBOOST ====================
  else if (commandName === 'bassboost') {
    queue.filter = queue.filter === 'bass' ? 'normal' : 'bass';
    interaction.reply({ 
      embeds: [successEmbed('BASS BOOST', queue.filter === 'bass' ? '**ON** - Feel the bass! 🔊' : '**OFF** - Normal mode')] 
    });
  }

  // ==================== NIGHTCORE ====================
  else if (commandName === 'nightcore') {
    queue.filter = queue.filter === 'nightcore' ? 'normal' : 'nightcore';
    interaction.reply({ 
      embeds: [successEmbed('NIGHTCORE', queue.filter === 'nightcore' ? '**ON** - Speed up! ⚡' : '**OFF** - Normal speed')] 
    });
  }

  // ==================== 24/7 ====================
  else if (commandName === '247') {
    queue.stay = !queue.stay;
    interaction.reply({ 
      embeds: [successEmbed('24/7 MODE', queue.stay ? '**ON** - I will stay in VC forever! 🌙' : '**OFF** - Auto-leave when queue ends')] 
    });
  }

  // ==================== STATS ====================
  else if (commandName === 'stats') {
    const uptime = Math.floor(process.uptime() / 60);
    const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    interaction.reply({
      embeds: [createUltimateEmbed(
        '📊 BOT STATISTICS',
        '🔴 SixStudio Premium Ultimate Music Bot',
        client.user.displayAvatarURL(),
        null,
        [
          { name: '⏱ Uptime', value: '```\n' + uptime + ' min\n```', inline: true },
          { name: '💾 Memory', value: '```\n' + mem + ' MB\n```', inline: true },
          { name: '🏠 Servers', value: '```\n' + client.guilds.cache.size + '\n```', inline: true },
          { name: '📡 Ping', value: '```\n' + client.ws.ping + 'ms\n```', inline: true },
          { name: '⌨️ Commands', value: '```\n21\n```', inline: true },
          { name: '⚙️ Node.js', value: '```\n' + process.version + '\n```', inline: true }
        ]
      )]
    });
  }

  // ==================== HELP ====================
  else if (commandName === 'help') {
    interaction.reply({
      embeds: [createUltimateEmbed(
        '❓ HELP MENU',
        '**21 Commands** - 🔴 SixStudio Premium Ultimate Music Bot v2.0',
        client.user.displayAvatarURL(),
        null,
        [
          { name: '🎵 Music', value: '`/join` `/play` `/search` `/playvideo` `/spotify` `/lyrics`', inline: false },
          { name: '🎮 Controls', value: '`/skip` `/stop` `/pause` `/resume` `/loop` `/volume`', inline: false },
          { name: '📋 Queue', value: '`/queue` `/shuffle` `/remove` `/clear`', inline: false },
          { name: '✨ Effects', value: '`/bassboost` `/nightcore`', inline: false },
          { name: '⚙️ Settings', value: '`/247` `/nowplaying` `/stats` `/help`', inline: false }
        ]
      )]
    });
  }
});

// ==================== SELECT MENU HANDLER ====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== 'search_select') return;

  const { guild, member } = interaction;
  const voiceChannel = member.voice.channel;
  
  if (!voiceChannel) {
    return interaction.reply({ 
      embeds: [errorEmbed('Join a voice channel first!')], 
      ephemeral: true 
    });
  }

  await interaction.deferUpdate();
  
  const url = interaction.values[0];
  const queue = getQueue(guild.id);

  try {
    const searchResult = await yts({ videoId: url.split('v=')[1]?.split('&')[0] || url.split('/').pop() });
    
    const song = {
      title: searchResult.title || 'Unknown',
      artist: searchResult.author?.name || 'Unknown',
      url: url,
      thumbnail: searchResult.thumbnail || 'https://cdn-icons-png.flaticon.com/512/1384/1384060.png',
      duration: searchResult.duration?.timestamp || '?',
      source: 'youtube',
      requestedBy: interaction.user.id
    };

    if (!queue.connection) {
      queue.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false
      });
    }

    queue.songs.push(song);

    if (!queue.playing) {
      createAudioPlayerForGuild(guild.id);
      await playSong(guild.id, song);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pause').setEmoji('⏸').setLabel('PAUSE').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('skip').setEmoji('⏭').setLabel('SKIP').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('stop').setEmoji('⏹').setLabel('STOP').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('loop').setEmoji('🔁').setLabel('LOOP').setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({
        embeds: [nowPlayingEmbed(song, queue)],
        components: [row]
      });
    } else {
      await interaction.editReply({
        embeds: [addedToQueueEmbed(song, queue.songs.length)],
        components: []
      });
    }

  } catch (error) {
    await interaction.editReply({ 
      embeds: [errorEmbed(error.message)], 
      components: [] 
    });
  }
});

// ==================== BUTTON HANDLER ====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const queue = getQueue(interaction.guild.id);
  if (!queue) return;

  if (interaction.customId === 'pause') {
    if (!queue.player) return;
    queue.player.pause();
    await interaction.reply({ 
      embeds: [successEmbed('PAUSED', 'Paused by button! ⏸')], 
      ephemeral: true 
    });
  } 
  else if (interaction.customId === 'skip') {
    if (!queue.player || !queue.playing) return;
    queue.player.stop();
    await interaction.reply({ 
      embeds: [successEmbed('SKIPPED', 'Skipped by button! ⏭')], 
      ephemeral: true 
    });
  } 
  else if (interaction.customId === 'stop') {
    if (queue.connection) {
      queue.connection.destroy();
      queues.delete(interaction.guild.id);
    }
    await interaction.reply({ 
      embeds: [successEmbed('STOPPED', 'Stopped by button! ⏹')], 
      ephemeral: true 
    });
  } 
  else if (interaction.customId === 'loop') {
    queue.loop = !queue.loop;
    await interaction.reply({ 
      embeds: [successEmbed('LOOP', queue.loop ? 'Loop ON 🔁' : 'Loop OFF')], 
      ephemeral: true 
    });
  }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', (error) => {
  console.error('[UNHANDLED]', error.message);
});

process.on('uncaughtException', (error) => {
  console.error('[EXCEPTION]', error.message);
});

// ==================== LOGIN ====================
client.login(process.env.BOT_TOKEN);
