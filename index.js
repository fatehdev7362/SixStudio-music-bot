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
  Routes
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

const ytdl = require('ytdl-core');
const youtubeSearch = require('youtube-search-api');

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
      textChannel: null
    });
  }
  return queues.get(guildId);
}

// ==================== ULTIMATE UI (NO EMOJI, ICON STYLE) ====================
function ultimateEmbed(title, description, thumbnail, image, fields) {
  const embed = new EmbedBuilder()
    .setColor(0x8B0000)
    .setTitle(`[>>] ${title}`)
    .setDescription(description || '')
    .setTimestamp()
    .setFooter({ 
      text: '|| SixStudio Premium || Ultimate Music System ||', 
      iconURL: 'https://i.imgur.com/8Km9tLL.png'
    });

  embed.setAuthor({
    name: '|| SIXSTUDIO ULTIMATE MUSIC ||',
    iconURL: 'https://i.imgur.com/8Km9tLL.png',
    url: 'https://discord.com'
  });

  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (fields) embed.addFields(fields);

  return embed;
}

function nowPlayingEmbed(song, queue) {
  const progress = '|| 00:00 >>----------<< ' + (song.duration || '?') + ' ||';
  
  const fields = [
    { name: '========================================', value: '** **', inline: false },
    { name: '[>>] ARTIST', value: '```ini\n[' + song.artist + ']\n```', inline: true },
    { name: '[>>] DURATION', value: '```ini\n[' + (song.duration || '?') + ']\n```', inline: true },
    { name: '[>>] VOLUME', value: '```ini\n[' + queue.volume + '%]\n```', inline: true },
    { name: '========================================', value: '** **', inline: false },
    { name: '[>>] REQUESTED BY', value: '<@' + song.requestedBy + '>', inline: true },
    { name: '[>>] SOURCE', value: song.source === 'spotify' ? '```ini\n[Spotify]\n```' : '```diff\n- YouTube -\n```', inline: true },
    { name: '[>>] LOOP', value: queue.loop ? '```diff\n+ ENABLED +\n```' : '```diff\n- DISABLED -\n```', inline: true },
    { name: '========================================', value: '** **', inline: false },
    { name: '[>>] PROGRESS', value: '`' + progress + '`', inline: false },
    { name: '========================================', value: '** **', inline: false }
  ];

  return ultimateEmbed(
    'NOW PLAYING',
    '**[' + song.title + '](' + song.url + ')**\n\n>> Enjoy the music! <<',
    song.thumbnail,
    null,
    fields
  );
}

function addedEmbed(song, position) {
  return ultimateEmbed(
    'ADDED TO QUEUE',
    '**[' + song.title + '](' + song.url + ')**',
    song.thumbnail,
    null,
    [
      { name: '[>>] ARTIST', value: '```ini\n[' + song.artist + ']\n```', inline: true },
      { name: '[>>] POSITION', value: '```ini\n[#' + position + ']\n```', inline: true },
      { name: '[>>] DURATION', value: '```ini\n[' + (song.duration || '?') + ']\n```', inline: true }
    ]
  );
}

function errorEmbed(message, tip) {
  return ultimateEmbed(
    '[!!] ERROR',
    '```diff\n- ' + message + '\n```' + (tip ? '\n[>>] Tip: ' + tip : ''),
    'https://i.imgur.com/4KZJZ9x.png'
  );
}

function successEmbed(title, message) {
  return ultimateEmbed(
    '[OK] ' + title,
    '```diff\n+ ' + message + '\n```'
  );
}

// ==================== AUDIO SYSTEM ====================
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
    console.error('[AUDIO ERROR]', error.message);
    const q = getQueue(guildId);
    q.songs.shift();
    if (q.songs.length > 0) {
      setTimeout(() => playSong(guildId, q.songs[0]), 1000);
    }
  });

  queue.player = player;
  return player;
}

async function playSong(guildId, song) {
  const queue = getQueue(guildId);
  
  try {
    console.log('[PLAYING]', song.title);
    
    const stream = ytdl(song.url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    });
    
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
    
  } catch (error) {
    console.error('[PLAY ERROR]', error.message);
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
    description: '[>>] Make bot join your voice channel'
  },
  {
    name: 'play',
    description: '[>>] Play music instantly',
    options: [{
      name: 'query',
      description: 'Song title or YouTube URL',
      type: 3,
      required: true
    }]
  },
  {
    name: 'search',
    description: '[>>] Search YouTube (10 results)',
    options: [{
      name: 'query',
      description: 'What to search',
      type: 3,
      required: true
    }]
  },
  {
    name: 'playvideo',
    description: '[>>] Play with BIG video preview',
    options: [{
      name: 'query',
      description: 'Video title or URL',
      type: 3,
      required: true
    }]
  },
  {
    name: 'queue',
    description: '[>>] Show current queue'
  },
  {
    name: 'skip',
    description: '[>>] Skip current song'
  },
  {
    name: 'stop',
    description: '[>>] Stop and leave'
  },
  {
    name: 'pause',
    description: '[>>] Pause music'
  },
  {
    name: 'resume',
    description: '[>>] Resume music'
  },
  {
    name: 'nowplaying',
    description: '[>>] Show now playing'
  },
  {
    name: 'loop',
    description: '[>>] Toggle loop'
  },
  {
    name: 'volume',
    description: '[>>] Set volume 1-200',
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
    description: '[>>] Shuffle queue'
  },
  {
    name: 'remove',
    description: '[>>] Remove song by position',
    options: [{
      name: 'position',
      description: 'Queue number',
      type: 4,
      required: true
    }]
  },
  {
    name: 'clear',
    description: '[>>] Clear queue'
  },
  {
    name: 'lyrics',
    description: '[>>] Search song info',
    options: [{
      name: 'query',
      description: 'Song title',
      type: 3,
      required: true
    }]
  },
  {
    name: 'bassboost',
    description: '[>>] Toggle bass boost'
  },
  {
    name: 'nightcore',
    description: '[>>] Toggle nightcore'
  },
  {
    name: '247',
    description: '[>>] Toggle 24/7 mode'
  },
  {
    name: 'stats',
    description: '[>>] Bot statistics'
  },
  {
    name: 'help',
    description: '[>>] Show all commands'
  }
];

// ==================== READY ====================
client.once('ready', async () => {
  console.log('[BOT] Logged in as', client.user.tag);
  
  client.user.setPresence({
    activities: [{ 
      name: '>> /play | Ultimate Music <<', 
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
    console.log('[BOT]', commands.length, 'Commands registered');
  } catch (error) {
    console.error('[BOT] Command error:', error.message);
  }

  setInterval(() => {
    console.log('[ALIVE]', new Date().toLocaleTimeString(), '| Guilds:', client.guilds.cache.size);
  }, 60000);
});

// ==================== COMMAND HANDLER ====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, member, guild, channel } = interaction;
  const queue = getQueue(guild.id);
  const voiceChannel = member.voice.channel;

  // ==================== JOIN ====================
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
        console.log('[VC] Connected to', voiceChannel.name);
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
        embeds: [successEmbed('JOINED', 'Connected to [' + voiceChannel.name + ']!')] 
      });
    } catch (error) {
      interaction.reply({ 
        embeds: [errorEmbed('Failed to join!', 'Check my permissions')] 
      });
    }
  }

  // ==================== PLAY ====================
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

      if (query.includes('youtube.com') || query.includes('youtu.be')) {
        await interaction.editReply({ embeds: [ultimateEmbed('[>>] YOUTUBE', 'Loading video...')] });
        
        const videoId = ytdl.getVideoID(query);
        const info = await ytdl.getInfo(videoId);
        
        song = {
          title: info.videoDetails.title,
          artist: info.videoDetails.author.name,
          url: query,
          thumbnail: info.videoDetails.thumbnails[0].url,
          duration: info.videoDetails.lengthSeconds ? 
            Math.floor(info.videoDetails.lengthSeconds / 60) + ':' + (info.videoDetails.lengthSeconds % 60).toString().padStart(2, '0') : 
            '?',
          source: 'youtube',
          requestedBy: member.id
        };
      } else {
        await interaction.editReply({ embeds: [ultimateEmbed('[>>] SEARCHING', 'Finding: [' + query + ']...')] });
        
        const searchResult = await youtubeSearch.GetListByKeyword(query, false, 1);
        if (!searchResult.items.length) {
          return interaction.editReply({ 
            embeds: [errorEmbed('No results found!', 'Try different keywords')] 
          });
        }

        const video = searchResult.items[0];
        song = {
          title: video.title,
          artist: video.channelTitle,
          url: 'https://www.youtube.com/watch?v=' + video.id,
          thumbnail: video.thumbnail.thumbnails[0].url,
          duration: '?',
          source: 'youtube',
          requestedBy: member.id
        };
      }

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
          new ButtonBuilder().setCustomId('pause').setLabel('[PAUSE]').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('skip').setLabel('[SKIP]').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('stop').setLabel('[STOP]').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('loop').setLabel('[LOOP]').setStyle(ButtonStyle.Success)
        );

        await interaction.editReply({
          embeds: [nowPlayingEmbed(song, queue)],
          components: [row]
        });
      } else {
        await interaction.editReply({
          embeds: [addedEmbed(song, queue.songs.length)]
        });
      }

    } catch (error) {
      console.error(error);
      await interaction.editReply({ 
        embeds: [errorEmbed('Failed to play!', error.message)] 
      });
    }
  }

  // ==================== SEARCH ====================
  else if (commandName === 'search') {
    await interaction.deferReply();

    const query = options.getString('query');

    try {
      const searchResult = await youtubeSearch.GetListByKeyword(query, false, 10);
      const videos = searchResult.items;

      if (!videos.length) {
        return interaction.editReply({ 
          embeds: [errorEmbed('No results found!')] 
        });
      }

      const options_select = videos.map((v, i) => 
        new StringSelectMenuOptionBuilder()
          .setLabel((i + 1) + '. ' + v.title.slice(0, 50))
          .setDescription((v.channelTitle + ' | ' + (v.length?.text || '?')).slice(0, 50))
          .setValue('https://www.youtube.com/watch?v=' + v.id)
      );

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('search_select')
          .setPlaceholder('[>>] Select a song to play...')
          .addOptions(options_select)
      );

      const embed = ultimateEmbed(
        '[>>] SEARCH RESULTS',
        'Found [' + videos.length + '] results for: `' + query + '`\n\nSelect from dropdown below',
        null,
        null,
        videos.slice(0, 5).map((v, i) => ({
          name: (i + 1) + '. ' + v.title.slice(0, 40),
          value: '|| ' + v.channelTitle + ' | ' + (v.length?.text || '?') + ' ||',
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

  // ==================== PLAYVIDEO ====================
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
        const searchResult = await youtubeSearch.GetListByKeyword(query, false, 1);
        if (!searchResult.items.length) throw new Error('Video not found');
        const video = searchResult.items[0];
        url = 'https://www.youtube.com/watch?v=' + video.id;
        videoInfo = video;
      } else {
        const videoId = ytdl.getVideoID(query);
        const info = await ytdl.getInfo(videoId);
        videoInfo = {
          title: info.videoDetails.title,
          channelTitle: info.videoDetails.author.name,
          thumbnail: { thumbnails: info.videoDetails.thumbnails }
        };
      }

      const song = {
        title: videoInfo.title,
        artist: videoInfo.channelTitle || 'Unknown',
        url: url,
        thumbnail: videoInfo.thumbnail?.thumbnails?.[0]?.url || videoInfo.thumbnail,
        duration: '?',
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

        const bigImage = videoInfo.thumbnail?.thumbnails?.[videoInfo.thumbnail.thumbnails.length - 1]?.url || 
                        videoInfo.thumbnail?.thumbnails?.[0]?.url || 
                        song.thumbnail;

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pause').setLabel('[PAUSE]').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('skip').setLabel('[SKIP]').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('stop').setLabel('[STOP]').setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({
          embeds: [ultimateEmbed(
            '[>>] VIDEO NOW PLAYING',
            '**[' + song.title + '](' + song.url + ')**\n\n>> Enjoy the video! <<',
            song.thumbnail,
            bigImage,
            [
              { name: '[>>] CHANNEL', value: '```ini\n[' + song.artist + ']\n```', inline: true },
              { name: '[>>] DURATION', value: '```ini\n[' + song.duration + ']\n```', inline: true },
              { name: '[>>] VOLUME', value: '```ini\n[' + queue.volume + '%]\n```', inline: true }
            ]
          )],
          components: [row]
        });
      } else {
        await interaction.editReply({
          embeds: [addedEmbed(song, queue.songs.length)]
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
        embeds: [ultimateEmbed('[>>] QUEUE', 'Queue is empty! Add songs with /play')] 
      });
    }

    const current = queue.songs[0];
    const upcoming = queue.songs.slice(1, 11).map((s, i) => 
      '`' + (i + 1) + '.` [' + s.title.slice(0, 35) + '](' + s.url + ') | `' + (s.duration || '?') + '`'
    ).join('\n') || '*No upcoming songs*';

    interaction.reply({
      embeds: [ultimateEmbed(
        '[>>] MUSIC QUEUE',
        '**' + queue.songs.length + '** songs in queue',
        current.thumbnail,
        null,
        [
          { name: '[>>] NOW PLAYING', value: '[' + current.title + '](' + current.url + ') | `' + (current.duration || '?') + '`', inline: false },
          { name: '[>>] UP NEXT', value: upcoming, inline: false },
          { name: '[>>] SETTINGS', value: 'Loop: `' + (queue.loop ? 'ON' : 'OFF') + '` | Volume: `' + queue.volume + '%` | 24/7: `' + (queue.stay ? 'ON' : 'OFF') + '`', inline: false }
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
      embeds: [successEmbed('SKIPPED', 'Skipped to next song!')] 
    });
  }

  // ==================== STOP ====================
  else if (commandName === 'stop') {
    if (queue.connection) {
      queue.connection.destroy();
      queues.delete(guild.id);
    }
    interaction.reply({ 
      embeds: [successEmbed('STOPPED', 'Left voice channel. Goodbye!')] 
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
      embeds: [successEmbed('PAUSED', 'Music paused. Use /resume to continue.')] 
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
      embeds: [successEmbed('RESUMED', 'Music resumed!')] 
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
      new ButtonBuilder().setCustomId('pause').setLabel('[PAUSE]').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('skip').setLabel('[SKIP]').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('stop').setLabel('[STOP]').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('loop').setLabel('[LOOP]').setStyle(ButtonStyle.Success)
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
      embeds: [successEmbed('LOOP MODE', queue.loop ? 'Loop is now ENABLED' : 'Loop is now DISABLED')] 
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
      embeds: [successEmbed('VOLUME SET', 'Volume changed to [' + vol + '%]')] 
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
      embeds: [successEmbed('SHUFFLED', 'Queue shuffled! [' + queue.songs.length + '] songs')] 
    });
  }

  // ==================== REMOVE ====================
  else if (commandName === 'remove') {
    const pos = options.getInteger('position');
    if (pos < 1 || pos >= queue.songs.length) {
      return interaction.reply({ 
        embeds: [errorEmbed('Invalid position! Use /queue to see numbers.')], 
        ephemeral: true 
      });
    }

    const removed = queue.songs.splice(pos, 1)[0];
    interaction.reply({ 
      embeds: [successEmbed('REMOVED', 'Removed: [' + removed.title + ']')] 
    });
  }

  // ==================== CLEAR ====================
  else if (commandName === 'clear') {
    const current = queue.songs[0];
    queue.songs = current ? [current] : [];
    interaction.reply({ 
      embeds: [successEmbed('CLEARED', 'Queue cleared! Keeping current song.')] 
    });
  }

  // ==================== LYRICS ====================
  else if (commandName === 'lyrics') {
    await interaction.deferReply();

    const query = options.getString('query');

    try {
      const searchResult = await youtubeSearch.GetListByKeyword(query, false, 1);
      if (!searchResult.items.length) throw new Error('Not found');

      const video = searchResult.items[0];
      interaction.editReply({
        embeds: [ultimateEmbed(
          '[>>] SONG INFO',
          '**[' + video.title + '](https://www.youtube.com/watch?v=' + video.id + ')**',
          video.thumbnail.thumbnails[0].url,
          null,
          [
            { name: '[>>] CHANNEL', value: '```ini\n[' + video.channelTitle + ']\n```', inline: true },
            { name: '[>>] LENGTH', value: '```ini\n[' + (video.length?.text || '?') + ']\n```', inline: true }
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
      embeds: [successEmbed('BASS BOOST', queue.filter === 'bass' ? 'ON - Feel the bass!' : 'OFF - Normal mode')] 
    });
  }

  // ==================== NIGHTCORE ====================
  else if (commandName === 'nightcore') {
    queue.filter = queue.filter === 'nightcore' ? 'normal' : 'nightcore';
    interaction.reply({ 
      embeds: [successEmbed('NIGHTCORE', queue.filter === 'nightcore' ? 'ON - Speed up!' : 'OFF - Normal speed')] 
    });
  }

  // ==================== 24/7 ====================
  else if (commandName === '247') {
    queue.stay = !queue.stay;
    interaction.reply({ 
      embeds: [successEmbed('24/7 MODE', queue.stay ? 'ON - I will stay in VC forever!' : 'OFF - Auto-leave when queue ends')] 
    });
  }

  // ==================== STATS ====================
  else if (commandName === 'stats') {
    const uptime = Math.floor(process.uptime() / 60);
    const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    interaction.reply({
      embeds: [ultimateEmbed(
        '[>>] BOT STATISTICS',
        '|| SixStudio Premium Ultimate Music Bot ||',
        client.user.displayAvatarURL(),
        null,
        [
          { name: '[>>] UPTIME', value: '```ini\n[' + uptime + ' min]\n```', inline: true },
          { name: '[>>] MEMORY', value: '```ini\n[' + mem + ' MB]\n```', inline: true },
          { name: '[>>] SERVERS', value: '```ini\n[' + client.guilds.cache.size + ']\n```', inline: true },
          { name: '[>>] PING', value: '```ini\n[' + client.ws.ping + 'ms]\n```', inline: true },
          { name: '[>>] COMMANDS', value: '```ini\n[21]\n```', inline: true },
          { name: '[>>] NODE.JS', value: '```ini\n[' + process.version + ']\n```', inline: true }
        ]
      )]
    });
  }

  // ==================== HELP ====================
  else if (commandName === 'help') {
    interaction.reply({
      embeds: [ultimateEmbed(
        '[>>] HELP MENU',
        '**21 Commands** - || SixStudio Premium Ultimate Music Bot ||',
        client.user.displayAvatarURL(),
        null,
        [
          { name: '[>>] MUSIC', value: '`/join` `/play` `/search` `/playvideo` `/lyrics`', inline: false },
          { name: '[>>] CONTROLS', value: '`/skip` `/stop` `/pause` `/resume` `/loop` `/volume`', inline: false },
          { name: '[>>] QUEUE', value: '`/queue` `/shuffle` `/remove` `/clear`', inline: false },
          { name: '[>>] EFFECTS', value: '`/bassboost` `/nightcore`', inline: false },
          { name: '[>>] SETTINGS', value: '`/247` `/nowplaying` `/stats` `/help`', inline: false }
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
    const videoId = ytdl.getVideoID(url);
    const info = await ytdl.getInfo(videoId);
    
    const song = {
      title: info.videoDetails.title,
      artist: info.videoDetails.author.name,
      url: url,
      thumbnail: info.videoDetails.thumbnails[0].url,
      duration: info.videoDetails.lengthSeconds ? 
        Math.floor(info.videoDetails.lengthSeconds / 60) + ':' + (info.videoDetails.lengthSeconds % 60).toString().padStart(2, '0') : 
        '?',
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
        new ButtonBuilder().setCustomId('pause').setLabel('[PAUSE]').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('skip').setLabel('[SKIP]').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('stop').setLabel('[STOP]').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('loop').setLabel('[LOOP]').setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({
        embeds: [nowPlayingEmbed(song, queue)],
        components: [row]
      });
    } else {
      await interaction.editReply({
        embeds: [addedEmbed(song, queue.songs.length)],
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
      embeds: [successEmbed('PAUSED', 'Paused by button!')], 
      ephemeral: true 
    });
  } 
  else if (interaction.customId === 'skip') {
    if (!queue.player || !queue.playing) return;
    queue.player.stop();
    await interaction.reply({ 
      embeds: [successEmbed('SKIPPED', 'Skipped by button!')], 
      ephemeral: true 
    });
  } 
  else if (interaction.customId === 'stop') {
    if (queue.connection) {
      queue.connection.destroy();
      queues.delete(interaction.guild.id);
    }
    await interaction.reply({ 
      embeds: [successEmbed('STOPPED', 'Stopped by button!')], 
      ephemeral: true 
    });
  } 
  else if (interaction.customId === 'loop') {
    queue.loop = !queue.loop;
    await interaction.reply({ 
      embeds: [successEmbed('LOOP', queue.loop ? 'Loop ON' : 'Loop OFF')], 
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
