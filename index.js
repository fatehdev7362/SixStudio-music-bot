require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ActivityType, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, NoSubscriberBehavior } = require('@discordjs/voice');
const play = require('play-dl');
const yts = require('yt-search');
const prism = require('prism-media');

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

function getQueue(gid) {
  if (!queues.has(gid)) {
    queues.set(gid, {
      songs: [],
      connection: null,
      player: null,
      playing: false,
      loop: false,
      volume: 100,
      stay: false,
      filter: 'normal'
    });
  }
  return queues.get(gid);
}

// ==================== SUPER KEREN EMBED ====================
function superEmbed(title, desc, thumb, fields, img) {
  const e = new EmbedBuilder()
    .setColor(0x8B0000) // Dark Red
    .setTitle('🎵 ' + title)
    .setDescription(desc || '')
    .setFooter({ 
      text: '🔴 SixStudio Premium | 24/7 Music Bot | Made with ❤️', 
      iconURL: 'https://cdn.discordapp.com/emojis/852881450052055050.webp?size=96&quality=lossless' 
    })
    .setTimestamp();
  
  if (thumb) e.setThumbnail(thumb);
  if (img) e.setImage(img);
  if (fields) e.addFields(fields);
  
  // Dark theme border effect
  e.setAuthor({
    name: '♪ SixStudio Music System',
    iconURL: 'https://cdn.discordapp.com/emojis/852881450052055050.webp?size=96&quality=lossless',
    url: 'https://discord.com'
  });
  
  return e;
}

function nowPlayingEmbed(song, q) {
  const fields = [
    { name: '👤 ┃ Artist', value: '```' + song.artist + '```', inline: true },
    { name: '⏱ ┃ Duration', value: '```' + (song.duration || '?') + '```', inline: true },
    { name: '🔊 ┃ Volume', value: '```' + q.volume + '%```', inline: true },
    { name: '🎧 ┃ Requested By', value: '<@' + song.requestedBy + '>', inline: true },
    { name: '📡 ┃ Source', value: song.source === 'spotify' ? '```Spotify 🟢```' : '```YouTube 🔴```', inline: true },
    { name: '🔁 ┃ Loop', value: q.loop ? '```ON 🟢```' : '```OFF ⚫```', inline: true },
    { name: '▶ ┃ Progress', value: '`00:00` ' + progressBar(0, 100, 15) + ' `' + (song.duration || '?') + '`', inline: false }
  ];
  
  return superEmbed('NOW PLAYING', '[**' + song.title + '**](' + song.url + ')', song.thumbnail, fields);
}

function progressBar(current, total, size) {
  if (!total) return '▬▬▬▬▬▬▬▬▬▬▬▬▬';
  const p = Math.round((current / total) * size);
  return '▬'.repeat(p) + '🔘' + '▬'.repeat(size - p - 1);
}

// ==================== AUDIO PLAYER ====================
function createPlayer(gid) {
  const q = getQueue(gid);
  const p = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play }
  });
  
  p.on(AudioPlayerStatus.Idle, () => {
    const x = getQueue(gid);
    if (x.loop && x.songs.length) x.songs.push(x.songs[0]);
    x.songs.shift();
    if (x.songs.length) {
      setTimeout(() => playSong(gid, x.songs[0]), 500);
    } else {
      x.playing = false;
      if (!x.stay) {
        setTimeout(() => {
          if (!x.playing && x.connection) {
            x.connection.destroy();
            queues.delete(gid);
          }
        }, 300000);
      }
    }
  });
  
  p.on('error', e => {
    console.error('[AUDIO]', e.message);
    const x = getQueue(gid);
    x.songs.shift();
    if (x.songs.length) setTimeout(() => playSong(gid, x.songs[0]), 500);
  });
  
  q.player = p;
  return p;
}

async function playSong(gid, song) {
  const q = getQueue(gid);
  try {
    let stream;
    if (song.source === 'spotify') {
      const r = await yts(song.title + ' ' + song.artist + ' official audio');
      if (!r.videos.length) throw new Error('No YouTube result');
      const v = r.videos[0];
      song.url = v.url;
      song.duration = v.duration.timestamp;
      stream = await play.stream(v.url, { quality: 0 });
    } else {
      stream = await play.stream(song.url, { quality: 0 });
    }
    
    const ffmpeg = new prism.FFmpeg({
      args: [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', 'pipe:0',
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2'
      ]
    });
    
    const pcm = stream.stream.pipe(ffmpeg);
    const resource = createAudioResource(pcm, {
      inputType: 2,
      inlineVolume: true
    });
    
    if (resource.volume) resource.volume.setVolume(q.volume / 100);
    
    q.player.play(resource);
    q.connection.subscribe(q.player);
    q.playing = true;
    console.log('[PLAY]', song.title);
  } catch (e) {
    console.error('[PLAY]', e.message);
    const x = getQueue(gid);
    x.songs.shift();
    if (x.songs.length) setTimeout(() => playSong(gid, x.songs[0]), 1000);
  }
}

// ==================== COMMANDS ====================
const commands = [
  { name: 'play', description: '▶ Play music from YouTube or Spotify', options: [{ name: 'query', description: 'Title, URL, or Spotify link', type: 3, required: true }] },
  { name: 'search', description: '🔍 Search YouTube (10 results)', options: [{ name: 'query', description: 'Search term', type: 3, required: true }] },
  { name: 'spotify', description: '🟢 Search and play from Spotify', options: [{ name: 'query', description: 'Song or artist', type: 3, required: true }] },
  { name: 'video', description: '📺 Play YouTube video with big preview', options: [{ name: 'query', description: 'Video title or URL', type: 3, required: true }] },
  { name: 'queue', description: '📋 Show music queue' },
  { name: 'skip', description: '⏭ Skip current song' },
  { name: 'stop', description: '⏹ Stop and leave VC' },
  { name: 'pause', description: '⏸ Pause music' },
  { name: 'resume', description: '▶ Resume music' },
  { name: 'nowplaying', description: '🎵 Show current song' },
  { name: 'loop', description: '🔁 Toggle loop mode' },
  { name: 'volume', description: '🔊 Set volume 1-200', options: [{ name: 'level', description: 'Volume level', type: 4, required: true }] },
  { name: 'shuffle', description: '🔀 Shuffle queue' },
  { name: 'remove', description: '🗑 Remove song by position', options: [{ name: 'position', description: 'Queue number', type: 4, required: true }] },
  { name: 'clear', description: '🧹 Clear queue except current' },
  { name: 'lyrics', description: '📝 Search song info', options: [{ name: 'query', description: 'Song title', type: 3, required: true }] },
  { name: 'bassboost', description: '🔊 Toggle bass boost' },
  { name: 'nightcore', description: '⚡ Toggle nightcore speed' },
  { name: '247', description: '🌙 Toggle 24/7 stay in VC' },
  { name: 'stats', description: '📊 Bot statistics' },
  { name: 'help', description: '❓ Show all commands' }
];

// ==================== BOT READY ====================
client.once('ready', async () => {
  console.log('[BOT] 🎵 Logged in as', client.user.tag);
  client.user.setActivity('/play | 24/7 Music', { type: ActivityType.Listening });
  
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('[BOT] ✅ Commands registered:', commands.length);
  } catch (e) {
    console.error('[BOT] ❌ Command error:', e.message);
  }
  
  setInterval(() => {
    console.log('[ALIVE] 💓', new Date().toLocaleTimeString());
  }, 60000);
});

// ==================== COMMAND HANDLER ====================
client.on('interactionCreate', async ix => {
  if (!ix.isChatInputCommand()) return;
  
  const { commandName: cmd, options, member, guild } = ix;
  const q = getQueue(guild.id);
  const vc = member.voice.channel;
  
  // ==================== PLAY ====================
  if (cmd === 'play') {
    if (!vc) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', '🔇 You must join a **voice channel** first!\n\nClick a voice channel then try again.')], 
      ephemeral: true 
    });
    
    await ix.deferReply();
    const query = options.getString('query');
    
    try {
      let song = {};
      
      if (query.includes('spotify.com/track')) {
        const id = query.split('/track/')[1].split('?')[0];
        const t = (await spotifyApi.getTrack(id)).body;
        song = {
          title: t.name,
          artist: t.artists.map(a => a.name).join(', '),
          url: query,
          thumbnail: t.album.images[0]?.url || 'https://cdn.discordapp.com/embed/avatars/0.png',
          duration: fmt(t.duration_ms),
          source: 'spotify',
          requestedBy: ix.user.id
        };
      } else if (query.startsWith('http') && play.yt_validate(query) === 'video') {
        const i = await play.video_info(query);
        song = {
          title: i.video_details.title,
          artist: i.video_details.channel?.name || 'Unknown',
          url: query,
          thumbnail: i.video_details.thumbnails[0]?.url || 'https://cdn.discordapp.com/embed/avatars/0.png',
          duration: i.video_details.durationRaw || '?',
          source: 'youtube',
          requestedBy: ix.user.id
        };
      } else {
        const r = await yts(query);
        if (!r.videos.length) throw new Error('Song not found');
        const v = r.videos[0];
        song = {
          title: v.title,
          artist: v.author.name,
          url: v.url,
          thumbnail: v.thumbnail,
          duration: v.duration.timestamp || '?',
          source: 'youtube',
          requestedBy: ix.user.id
        };
      }
      
      if (!q.connection) {
        q.connection = joinVoiceChannel({
          channelId: vc.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator
        });
        q.connection.on(VoiceConnectionStatus.Disconnected, () => {
          setTimeout(() => {
            if (q.connection?.state.status === VoiceConnectionStatus.Disconnected) {
              q.connection.destroy();
              queues.delete(guild.id);
            }
          }, 5000);
        });
      }
      
      q.songs.push(song);
      
      if (!q.playing) {
        createPlayer(guild.id);
        await playSong(guild.id, song);
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pause').setLabel('⏸ PAUSE').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('skip').setLabel('⏭ SKIP').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('stop').setLabel('⏹ STOP').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('loop').setLabel('🔁 LOOP').setStyle(ButtonStyle.Success)
        );
        
        await ix.editReply({
          embeds: [nowPlayingEmbed(song, q)],
          components: [row]
        });
      } else {
        await ix.editReply({
          embeds: [superEmbed('📥 ADDED TO QUEUE', '[**' + song.title + '**](' + song.url + ')', song.thumbnail, [
            { name: '👤 Artist', value: '```' + song.artist + '```', inline: true },
            { name: '#️⃣ Position', value: '```#' + q.songs.length + '```', inline: true },
            { name: '⏱ Duration', value: '```' + song.duration + '```', inline: true }
          ])]
        });
      }
    } catch (e) {
      console.error(e);
      await ix.editReply({ 
        embeds: [superEmbed('❌ ERROR', 'Failed to play:\n```' + e.message + '```\n\n💡 Try a different song or check the URL')] 
      });
    }
  }
  
  // ==================== VIDEO (BIG PREVIEW) ====================
  else if (cmd === 'video') {
    if (!vc) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', '🔇 Join a voice channel first!')], 
      ephemeral: true 
    });
    
    await ix.deferReply();
    const query = options.getString('query');
    
    try {
      let url = query;
      if (!query.startsWith('http')) {
        const r = await yts(query);
        if (!r.videos.length) throw new Error('Video not found');
        url = r.videos[0].url;
      }
      
      const i = await play.video_info(url);
      const song = {
        title: i.video_details.title,
        artist: i.video_details.channel?.name || 'Unknown',
        url: url,
        thumbnail: i.video_details.thumbnails[0]?.url,
        image: i.video_details.thumbnails[i.video_details.thumbnails.length - 1]?.url || i.video_details.thumbnails[0]?.url,
        duration: i.video_details.durationRaw || '?',
        source: 'youtube',
        requestedBy: ix.user.id
      };
      
      if (!q.connection) {
        q.connection = joinVoiceChannel({
          channelId: vc.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator
        });
      }
      
      q.songs.push(song);
      
      if (!q.playing) {
        createPlayer(guild.id);
        await playSong(guild.id, song);
        
        await ix.editReply({
          embeds: [superEmbed('📺 VIDEO NOW PLAYING', '[**' + song.title + '**](' + song.url + ')', song.thumbnail, [
            { name: '👤 Channel', value: '```' + song.artist + '```', inline: true },
            { name: '⏱ Duration', value: '```' + song.duration + '```', inline: true },
            { name: '🔊 Volume', value: '```' + q.volume + '%```', inline: true }
          ], song.image)],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pause').setLabel('⏸').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('skip').setLabel('⏭').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('stop').setLabel('⏹').setStyle(ButtonStyle.Danger)
          )]
        });
      } else {
        await ix.editReply({
          embeds: [superEmbed('📥 VIDEO QUEUED', '[**' + song.title + '**](' + song.url + ')', song.thumbnail, [
            { name: '👤 Channel', value: '```' + song.artist + '```', inline: true },
            { name: '#️⃣ Position', value: '```#' + q.songs.length + '```', inline: true }
          ], song.image)]
        });
      }
    } catch (e) {
      await ix.editReply({ embeds: [superEmbed('❌ ERROR', e.message)] });
    }
  }
  
  // ==================== SEARCH ====================
  else if (cmd === 'search') {
    await ix.deferReply();
    const query = options.getString('query');
    
    try {
      const r = await yts(query);
      const v = r.videos.slice(0, 10);
      if (!v.length) return ix.editReply({ embeds: [superEmbed('❌ ERROR', 'No results found!')] });
      
      const opts = v.map((x, i) => ({
        label: (i + 1) + '. ' + x.title.slice(0, 45),
        description: (x.author.name + ' | ' + x.duration.timestamp).slice(0, 50),
        value: x.url
      }));
      
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('search_pick')
          .setPlaceholder('🔍 Select a song to play...')
          .addOptions(opts)
      );
      
      await ix.editReply({
        embeds: [superEmbed('🔍 YOUTUBE SEARCH', 'Found **' + v.length + '** results for: `' + query + '`\n\nPick from dropdown below 👇')],
        components: [row]
      });
    } catch (e) {
      await ix.editReply({ embeds: [superEmbed('❌ ERROR', e.message)] });
    }
  }
  
  // ==================== SPOTIFY ====================
  else if (cmd === 'spotify') {
    if (!vc) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', '🔇 Join a voice channel first!')], 
      ephemeral: true 
    });
    
    await ix.deferReply();
    const query = options.getString('query');
    
    try {
      const r = await spotifyApi.searchTracks(query, { limit: 1 });
      if (!r.body.tracks.items.length) throw new Error('No Spotify results');
      
      const t = r.body.tracks.items[0];
      const song = {
        title: t.name,
        artist: t.artists.map(a => a.name).join(', '),
        url: t.external_urls.spotify,
        thumbnail: t.album.images[0]?.url || 'https://cdn.discordapp.com/embed/avatars/0.png',
        duration: fmt(t.duration_ms),
        source: 'spotify',
        requestedBy: ix.user.id
      };
      
      if (!q.connection) {
        q.connection = joinVoiceChannel({
          channelId: vc.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator
        });
      }
      
      q.songs.push(song);
      
      if (!q.playing) {
        createPlayer(guild.id);
        await playSong(guild.id, song);
        
        await ix.editReply({
          embeds: [superEmbed('🟢 SPOTIFY NOW PLAYING', '[**' + song.title + '**](' + song.url + ')', song.thumbnail, [
            { name: '👤 Artist', value: '```' + song.artist + '```', inline: true },
            { name: '⏱ Duration', value: '```' + song.duration + '```', inline: true },
            { name: '🔊 Volume', value: '```' + q.volume + '%```', inline: true },
            { name: '🎧 By', value: '<@' + song.requestedBy + '>', inline: true }
          ])],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pause').setLabel('⏸').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('skip').setLabel('⏭').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('stop').setLabel('⏹').setStyle(ButtonStyle.Danger)
          )]
        });
      } else {
        await ix.editReply({
          embeds: [superEmbed('📥 SPOTIFY QUEUED', '[**' + song.title + '**](' + song.url + ')', song.thumbnail, [
            { name: '👤 Artist', value: '```' + song.artist + '```', inline: true },
            { name: '#️⃣ Position', value: '```#' + q.songs.length + '```', inline: true }
          ])]
        });
      }
    } catch (e) {
      await ix.editReply({ embeds: [superEmbed('❌ ERROR', e.message)] });
    }
  }
  
  // ==================== QUEUE ====================
  else if (cmd === 'queue') {
    if (!q.songs.length) return ix.reply({ embeds: [superEmbed('📋 QUEUE', 'Queue is empty!')] });
    
    const c = q.songs[0];
    const n = q.songs.slice(1, 11).map((s, i) => 
      '`' + (i + 1) + '.` [' + s.title.slice(0, 35) + '](' + s.url + ') | `' + (s.duration || '?') + '`'
    ).join('\n') || '*No more songs*';
    
    ix.reply({
      embeds: [superEmbed('📋 MUSIC QUEUE', '**' + q.songs.length + '** songs in queue', c.thumbnail, [
        { name: '▶ NOW PLAYING', value: '[' + c.title + '](' + c.url + ') | `' + (c.duration || '?') + '`', inline: false },
        { name: '📥 UP NEXT', value: n, inline: false },
        { name: '⚙️ Settings', value: '🔁 Loop: ' + (q.loop ? '`ON`' : '`OFF`') + ' | 🔊 Volume: `' + q.volume + '%` | 🌙 24/7: ' + (q.stay ? '`ON`' : '`OFF`'), inline: false }
      ])]
    });
  }
  
  // ==================== CONTROLS ====================
  else if (cmd === 'skip') {
    if (!q.player || !q.playing) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', 'Nothing is playing!')], 
      ephemeral: true 
    });
    q.player.stop();
    ix.reply({ embeds: [superEmbed('⏭ SKIPPED', 'Skipped to next song! 🎵')] });
  }
  
  else if (cmd === 'stop') {
    if (q.connection) {
      q.connection.destroy();
      queues.delete(guild.id);
    }
    ix.reply({ embeds: [superEmbed('⏹ STOPPED', 'Left voice channel. Goodbye! 👋')] });
  }
  
  else if (cmd === 'pause') {
    if (!q.player) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', 'Nothing to pause!')], 
      ephemeral: true 
    });
    q.player.pause();
    ix.reply({ embeds: [superEmbed('⏸ PAUSED', 'Music paused. Use `/resume` to continue.')] });
  }
  
  else if (cmd === 'resume') {
    if (!q.player) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', 'Nothing to resume!')], 
      ephemeral: true 
    });
    q.player.unpause();
    ix.reply({ embeds: [superEmbed('▶ RESUMED', 'Music resumed! 🎵')] });
  }
  
  else if (cmd === 'nowplaying') {
    if (!q.songs.length || !q.playing) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', 'Nothing is playing!')], 
      ephemeral: true 
    });
    
    const c = q.songs[0];
    ix.reply({
      embeds: [superEmbed('🎵 NOW PLAYING', '[**' + c.title + '**](' + c.url + ')', c.thumbnail, [
        { name: '👤 Artist', value: '```' + c.artist + '```', inline: true },
        { name: '⏱ Duration', value: '```' + (c.duration || '?') + '```', inline: true },
        { name: '📡 Source', value: c.source === 'spotify' ? '```Spotify 🟢```' : '```YouTube 🔴```', inline: true },
        { name: '🎧 By', value: '<@' + c.requestedBy + '>', inline: true }
      ])]
    });
  }
  
  else if (cmd === 'loop') {
    q.loop = !q.loop;
    ix.reply({ 
      embeds: [superEmbed('🔁 LOOP MODE', q.loop ? 'Loop is now **ENABLED** 🟢' : 'Loop is now **DISABLED** ⚫')] 
    });
  }
  
  else if (cmd === 'volume') {
    const vol = options.getInteger('level');
    if (vol < 1 || vol > 200) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', 'Volume must be 1-200!')], 
      ephemeral: true 
    });
    
    q.volume = vol;
    if (q.player && q.player.state.resource && q.player.state.resource.volume) {
      q.player.state.resource.volume.setVolume(vol / 100);
    }
    ix.reply({ 
      embeds: [superEmbed('🔊 VOLUME SET', 'Volume changed to **' + vol + '%**')] 
    });
  }
  
  else if (cmd === 'shuffle') {
    if (q.songs.length < 3) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', 'Need at least 3 songs!')], 
      ephemeral: true 
    });
    
    const cur = q.songs[0];
    const rest = q.songs.slice(1);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    q.songs = [cur, ...rest];
    ix.reply({ 
      embeds: [superEmbed('🔀 SHUFFLED', 'Queue shuffled! **' + q.songs.length + '** songs')] 
    });
  }
  
  else if (cmd === 'remove') {
    const pos = options.getInteger('position');
    if (pos < 1 || pos >= q.songs.length) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', 'Invalid position! Use `/queue` to see numbers.')], 
      ephemeral: true 
    });
    
    const rem = q.songs.splice(pos, 1)[0];
    ix.reply({ 
      embeds: [superEmbed('🗑 REMOVED', 'Removed: **' + rem.title + '**')] 
    });
  }
  
  else if (cmd === 'clear') {
    const cur = q.songs[0];
    q.songs = [cur];
    ix.reply({ 
      embeds: [superEmbed('🧹 CLEARED', 'Queue cleared! Keeping current song.')] 
    });
  }
  
  else if (cmd === 'lyrics') {
    await ix.deferReply();
    const query = options.getString('query');
    
    try {
      const r = await yts(query);
      if (!r.videos.length) throw new Error('Not found');
      const v = r.videos[0];
      
      ix.editReply({
        embeds: [superEmbed('📝 SONG INFO', '[**' + v.title + '**](' + v.url + ')', v.thumbnail, [
          { name: '👤 Channel', value: '```' + v.author.name + '```', inline: true },
          { name: '⏱ Duration', value: '```' + v.duration.timestamp + '```', inline: true },
          { name: '👁 Views', value: '```' + v.views + '```', inline: true }
        ])]
      });
    } catch (e) {
      ix.editReply({ embeds: [superEmbed('❌ ERROR', e.message)] });
    }
  }
  
  else if (cmd === 'bassboost') {
    q.filter = q.filter === 'bass' ? 'normal' : 'bass';
    ix.reply({ 
      embeds: [superEmbed('🔊 BASS BOOST', q.filter === 'bass' ? '**ON** - Feel the bass! 🎵' : '**OFF** - Normal mode')] 
    });
  }
  
  else if (cmd === 'nightcore') {
    q.filter = q.filter === 'nightcore' ? 'normal' : 'nightcore';
    ix.reply({ 
      embeds: [superEmbed('⚡ NIGHTCORE', q.filter === 'nightcore' ? '**ON** - Speed up! 🚀' : '**OFF** - Normal speed')] 
    });
  }
  
  else if (cmd === '247') {
    q.stay = !q.stay;
    ix.reply({ 
      embeds: [superEmbed('🌙 24/7 MODE', q.stay ? '**ON** - I will stay in VC forever! 🌙' : '**OFF** - Auto-leave when queue ends')] 
    });
  }
  
  else if (cmd === 'stats') {
    const up = Math.floor(process.uptime() / 60);
    const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    
    ix.reply({
      embeds: [superEmbed('📊 BOT STATS', '🔴 SixStudio Premium Music Bot', client.user.displayAvatarURL(), [
        { name: '⏱ Uptime', value: '```' + up + ' min```', inline: true },
        { name: '💾 Memory', value: '```' + mem + ' MB```', inline: true },
        { name: '🏠 Servers', value: '```' + client.guilds.cache.size + '```', inline: true },
        { name: '📡 Ping', value: '```' + client.ws.ping + 'ms```', inline: true },
        { name: '⌨️ Commands', value: '```21```', inline: true },
        { name: '⚙️ Node.js', value: '```' + process.version + '```', inline: true }
      ])]
    });
  }
  
  else if (cmd === 'help') {
    ix.reply({
      embeds: [superEmbed('❓ HELP MENU', '**21 Commands** - 🔴 SixStudio Premium Music Bot', client.user.displayAvatarURL(), [
        { name: '🎵 Music', value: '`/play` `/search` `/spotify` `/video` `/lyrics`', inline: false },
        { name: '🎮 Controls', value: '`/skip` `/stop` `/pause` `/resume` `/loop` `/volume`', inline: false },
        { name: '📋 Queue', value: '`/queue` `/shuffle` `/remove` `/clear`', inline: false },
        { name: '✨ Effects', value: '`/bassboost` `/nightcore`', inline: false },
        { name: '⚙️ Settings', value: '`/247` `/nowplaying` `/stats` `/help`', inline: false }
      ])]
    });
  }
});

// ==================== SELECT MENU & BUTTONS ====================
client.on('interactionCreate', async ix => {
  if (ix.isStringSelectMenu() && ix.customId === 'search_pick') {
    const { guild, member } = ix;
    const vc = member.voice.channel;
    if (!vc) return ix.reply({ 
      embeds: [superEmbed('❌ ERROR', '🔇 Join VC first!')], 
      ephemeral: true 
    });
    
    await ix.deferUpdate();
    const url = ix.values[0];
    const q = getQueue(guild.id);
    
    try {
      const i = await play.video_info(url);
      const song = {
        title: i.video_details.title,
        artist: i.video_details.channel?.name || 'Unknown',
        url: url,
        thumbnail: i.video_details.thumbnails[0]?.url || 'https://cdn.discordapp.com/embed/avatars/0.png',
        duration: i.video_details.durationRaw || '?',
        source: 'youtube',
        requestedBy: ix.user.id
      };
      
      if (!q.connection) {
        q.connection = joinVoiceChannel({
          channelId: vc.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator
        });
      }
      
      q.songs.push(song);
      
      if (!q.playing) {
        createPlayer(guild.id);
        await playSong(guild.id, song);
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pause').setLabel('⏸ PAUSE').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('skip').setLabel('⏭ SKIP').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('stop').setLabel('⏹ STOP').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('loop').setLabel('🔁 LOOP').setStyle(ButtonStyle.Success)
        );
        
        await ix.editReply({
          embeds: [nowPlayingEmbed(song, q)],
          components: [row]
        });
      } else {
        await ix.editReply({
          embeds: [superEmbed('📥 QUEUED', '[**' + song.title + '**](' + song.url + ')', song.thumbnail, [
            { name: '👤 Artist', value: '```' + song.artist + '```', inline: true },
            { name: '#️⃣ Position', value: '```#' + q.songs.length + '```', inline: true }
          ])],
          components: []
        });
      }
    } catch (e) {
      await ix.editReply({ 
        embeds: [superEmbed('❌ ERROR', e.message)], 
        components: [] 
      });
    }
  }
  
  if (ix.isButton()) {
    const q = getQueue(ix.guild.id);
    if (!q) return;
    
    if (ix.customId === 'pause') {
      if (!q.player) return;
      q.player.pause();
      await ix.reply({ 
        embeds: [superEmbed('⏸ PAUSED', 'Paused by button!')], 
        ephemeral: true 
      });
    } else if (ix.customId === 'skip') {
      if (!q.player || !q.playing) return;
      q.player.stop();
      await ix.reply({ 
        embeds: [superEmbed('⏭ SKIPPED', 'Skipped by button!')], 
        ephemeral: true 
      });
    } else if (ix.customId === 'stop') {
      if (q.connection) {
        q.connection.destroy();
        queues.delete(ix.guild.id);
      }
      await ix.reply({ 
        embeds: [superEmbed('⏹ STOPPED', 'Stopped by button!')], 
        ephemeral: true 
      });
    } else if (ix.customId === 'loop') {
      q.loop = !q.loop;
      await ix.reply({ 
        embeds: [superEmbed('🔁 LOOP', q.loop ? 'Loop ON 🟢' : 'Loop OFF ⚫')], 
        ephemeral: true 
      });
    }
  }
});

process.on('unhandledRejection', e => console.error('[ERR]', e.message));
process.on('uncaughtException', e => console.error('[FATAL]', e.message));

client.login(process.env.BOT_TOKEN);
