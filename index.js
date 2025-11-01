// ==========================================================
//  1. SETUP AUR IMPORTS
// ==========================================================

// Zaroori packages import karein
const express = require('express'); // Web server framework
const cors = require('cors');       // Doosri websites se requests allow karne ke liye
const axios = require('axios');     // Invidious API par HTTP request karne ke liye

// Application ke liye constants define karein
const app = express();
const PORT = process.env.PORT || 3000; // Environment se port lein ya default 3000 istemal karein
const INVIDIOUS_API_BASE = 'https://inv.perditum.com/api/v1';
const INVIDIOUS_DOMAIN = 'https://inv.perditum.com';

// Middleware istemal karein
app.use(cors()); // Cross-Origin Resource Sharing (CORS) ko enable karein
app.use(express.static('public')); // 'public' folder se static files serve karein


// ==========================================================
//  2. UTILITY AUR FORMATTING HELPERS
// ==========================================================

/**
 * WebVTT format ke string ko ek structured transcript array mein badalta hai.
 * @param {string} vttString - VTT format ka raw string.
 * @returns {Array<{start: number, text: string}>} - Transcript objects ka array.
 */
function parseWebVTT(vttString) {
    if (typeof vttString !== 'string') return [];

    const lines = vttString.split('\n');
    const transcript = [];

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) {
            const timeParts = lines[i].split(' --> ');
            const startTimeString = timeParts[0];
            const timeSegments = startTimeString.split(':'); // HH:MM:SS.ms

            // Timestamp ko milliseconds mein convert karein
            const hours = timeSegments.length > 2 ? parseInt(timeSegments[0], 10) : 0;
            const minutes = parseInt(timeSegments[timeSegments.length - 2], 10);
            const seconds = parseFloat(timeSegments[timeSegments.length - 1]);
            const startTimeMs = (hours * 3600 + minutes * 60 + seconds) * 1000;

            // Agli lines ko text ke roop mein jodein jab tak ek khali line na mile
            let text = '';
            let j = i + 1;
            while (j < lines.length && lines[j] !== '') {
                text += lines[j] + ' ';
                j++;
            }
            transcript.push({ start: startTimeMs, text: text.trim() });
            i = j; // Loop ko aage badhayein
        }
    }
    return transcript;
}

/**
 * Ek number ko comma-separated string mein format karta hai (jaise 1,234,567).
 * @param {number} num - Format karne wala number.
 * @returns {string} - Formatted string ya "N/A".
 */
const formatNumber = (num) => num != null ? new Intl.NumberFormat('en-US').format(num) : "N/A";

/**
 * Date string ko 'YYYY-MM-DD' format mein badalta hai.
 * @param {string} dateString - ISO format ka date string.
 * @returns {string} - Formatted date ya "N/A".
 */
const formatDate = (dateString) => dateString ? new Date(dateString).toISOString().split('T')[0] : "N/A";

/**
 * Seconds ko "HH:MM:SS" ya "MM:SS" format mein badalta hai.
 * @param {number} totalSeconds - Kul seconds.
 * @returns {string} - Formatted duration ya "N/A".
 */
function formatDuration(totalSeconds) {
    if (totalSeconds == null || isNaN(totalSeconds)) return "N/A";
    if (totalSeconds < 60) return `${Math.round(totalSeconds)} seconds`;

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(seconds).padStart(2, '0');

    if (hours > 0) {
        return `${hours}:${paddedMinutes}:${paddedSeconds}`;
    }
    return `${minutes}:${paddedSeconds}`;
}

/**
 * Transcript ke liye seconds ko "HH:MM:SS" ya "MM:SS" format mein badalta hai.
 * @param {number} totalSeconds - Kul seconds.
 * @returns {string} - Formatted timestamp ya "00:00".
 */
function formatTimestamp(totalSeconds) {
    if (totalSeconds == null || isNaN(totalSeconds)) return "00:00";

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(seconds).padStart(2, '0');

    if (hours > 0) {
        return `${hours}:${paddedMinutes}:${paddedSeconds}`;
    }
    return `${minutes}:${paddedSeconds}`;
}


// ==========================================================
//  3. CORE API DATA FETCHERS (API SE DATA LAANE WALE FUNCTIONS)
// ==========================================================

/**
 * Ek video ki poori details Invidious API se fetch karta hai.
 * @param {string} videoId - Video ki unique ID.
 * @returns {Promise<Object>} - Video details ka object.
 */
async function getVideoDetails(videoId) {
    const response = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}`);
    return response.data;
}

/**
 * Ek video ke comments fetch karta hai.
 * @param {string} videoId - Video ki unique ID.
 * @returns {Promise<Object>} - Comments ka object.
 */
async function getComments(videoId) {
    const response = await axios.get(`${INVIDIOUS_API_BASE}/comments/${videoId}`);
    return response.data;
}

/**
 * Ek channel ki details uski ID se fetch karta hai.
 * @param {string} channelId - Channel ki unique ID.
 * @returns {Promise<Object>} - Channel details ka object.
 */
async function getChannelDetails(channelId) {
    const response = await axios.get(`${INVIDIOUS_API_BASE}/authors/${channelId}`);
    return response.data;
}

/**
 * Ek search query ke liye Invidious par search karta hai.
 * @param {string} query - Search karne wala text.
 * @returns {Promise<Array>} - Search results ka array.
 */
async function performSearch(query) {
    const searchUrl = `${INVIDIOUS_API_BASE}/search?q=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl);
    return response.data;
}

/**
 * Video ka transcript (subtitles) fetch aur parse karta hai.
 * @param {string} videoId - Video ki unique ID.
 * @returns {Promise<Array>} - Parsed transcript ka array.
 */
async function getTranscript(videoId) {
    const captionsUrl = `${INVIDIOUS_API_BASE}/videos/${videoId}?fields=captions`;
    const captionsResponse = await axios.get(captionsUrl);
    const captions = captionsResponse.data.captions;

    if (!captions || captions.length === 0) {
        throw new Error("Is video ke liye koi captions uplabdh nahi hai.");
    }

    const transcriptPath = captions[0].url;
    const fullTranscriptUrl = `${INVIDIOUS_DOMAIN}${transcriptPath}`;

    const transcriptResponse = await axios.get(fullTranscriptUrl);
    const data = transcriptResponse.data;

    // Alag-alag transcript formats ko handle karein
    if (typeof data === 'string') {
        return parseWebVTT(data);
    }
    if (typeof data === 'object') {
        if (Array.isArray(data.captions)) return data.captions;
        if (Array.isArray(data.lines)) return data.lines;
        if (Array.isArray(data)) return data;
    }

    throw new Error("Transcript data ko parse nahi kiya ja saka.");
}


// ==========================================================
//  4. DOWNLOAD/STREAM LINKS BANANE KA LOGIC
// ==========================================================

/**
 * Invidious se mile raw format data se saaf download/stream links banata hai.
 * @param {Object} videoDetails - `getVideoDetails` se mila poora details object.
 * @returns {{combined: Array, videoOnly: Array, audioOnly: Array}} - Categories mein links ka object.
 */
function generateStreamLinks(videoDetails) {
    const videoId = videoDetails.videoId;
    const combined = [];
    const videoOnly = [];
    const audioOnly = [];

    // Combined audio+video streams (aam taur par kam quality wale)
    if (Array.isArray(videoDetails.formatStreams)) {
        videoDetails.formatStreams.forEach(format => {
            combined.push({
                quality: format.qualityLabel,
                itag: format.itag,
                type: 'Video + Audio',
                container: format.container,
                url: `${INVIDIOUS_DOMAIN}/download?v=${videoId}&itag=${format.itag}`
            });
        });
    }

    // Adaptive formats (high quality video-only ya audio-only)
    if (Array.isArray(videoDetails.adaptiveFormats)) {
        videoDetails.adaptiveFormats.forEach(format => {
            const streamUrl = `${INVIDIOUS_DOMAIN}/download?v=${videoId}&itag=${format.itag}`;

            if (format.type.startsWith('video/')) {
                videoOnly.push({
                    quality: format.qualityLabel,
                    itag: format.itag,
                    type: 'Video Only',
                    container: format.container,
                    url: streamUrl
                });
            } else if (format.type.startsWith('audio/')) {
                audioOnly.push({
                    quality: `${Math.round(format.bitrate / 1000)}kbps`, // bps ko kbps mein badle
                    itag: format.itag,
                    type: 'Audio Only',
                    container: format.container,
                    url: streamUrl
                });
            }
        });
    }

    return { combined, videoOnly, audioOnly };
}


// ==========================================================
//  5. PUBLIC API ENDPOINTS
// ==========================================================

/**
 * ENDPOINT 1: /api/fetch - Raw Data Forwarder
 * Alag-alag data types (details, comments, etc.) ko ek saath fetch karta hai.
 */
app.get('/api/fetch', async (req, res) => {
    const { id: videoId, channel: channelId, search: query } = req.query;
    const fields = req.query.fields ? req.query.fields.split(',').map(f => f.trim()) : [];

    if (!videoId && !channelId && !query) {
        return res.status(400).json({ error: "'id', 'channel', ya 'search' parameter zaroori hai." });
    }

    try {
        const tasks = [];
        const responseKeys = [];

        if (videoId) {
            if (fields.includes('details')) { tasks.push(getVideoDetails(videoId)); responseKeys.push('details'); }
            if (fields.includes('comments')) { tasks.push(getComments(videoId)); responseKeys.push('comments'); }
            if (fields.includes('transcript')) { tasks.push(getTranscript(videoId)); responseKeys.push('transcript'); }
        }
        if (channelId && fields.includes('channel')) { tasks.push(getChannelDetails(channelId)); responseKeys.push('channel'); }
        if (query) { tasks.push(performSearch(query)); responseKeys.push('search_results'); }

        if (tasks.length === 0) {
            return res.status(400).json({ error: "Koi valid fields ya parameters nahi diye gaye." });
        }

        const results = await Promise.allSettled(tasks);
        const finalResponse = {};

        results.forEach((result, index) => {
            const key = responseKeys[index];
            if (result.status === 'fulfilled') {
                finalResponse[key] = result.value;
            } else {
                finalResponse[key] = { error: `${key} fetch nahi ho saka`, details: result.reason?.message || 'Unknown error' };
            }
        });

        res.json(finalResponse);
    } catch (error) {
        res.status(500).json({ error: "Server par ek anapekshit galti hui.", details: error.message });
    }
});

/**
 * ENDPOINT 2: /api/formats - Saaf Download Links paane ke liye
 */
app.get('/api/formats', async (req, res) => {
    const { v: videoId } = req.query;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID 'v' zaroori hai." });
    }
    try {
        const videoDetails = await getVideoDetails(videoId);
        const links = generateStreamLinks(videoDetails);
        res.json(links);
    } catch (error) {
        res.status(500).json({ error: `Formats paane mein vifal: ${error.message}` });
    }
});

/**
 * ENDPOINT 3: /api/stream - High-Speed Stream Proxy
 * Video/Audio ko seedhe user tak stream karta hai.
 */
app.get('/api/stream', async (req, res) => {
    const { v: videoId, itag } = req.query;
    if (!videoId || !itag) {
        return res.status(400).json({ error: "Video ID 'v' aur 'itag' dono zaroori hain." });
    }

    try {
        // Invidious ke liye direct proxy URL banayein
        const streamUrl = `${INVIDIOUS_DOMAIN}/download?v=${videoId}&itag=${itag}&local=false`;

        // Request karein aur stream ko seedhe user ko pipe karein
        const response = await axios({
            method: 'get',
            url: streamUrl,
            responseType: 'stream'
        });

        // Invidious se mile headers ko hamare response mein forward karein
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Content-Length', response.headers['content-length']);
        
        // Video/audio data ko pipe karein
        response.data.pipe(res);

    } catch (error) {
        res.status(500).send(`Content stream karte samay galti: ${error.message}`);
    }
});

/**
 * Ek video ke liye vishleshan report banata hai.
 * @param {string} videoId - Video ki unique ID.
 * @returns {Promise<string>} - Markdown format mein text report.
 */
async function generateLlmReport(videoId) {
    // Details, comments, aur transcript ek saath fetch karein
    const results = await Promise.allSettled([
        getVideoDetails(videoId),
        getComments(videoId),
        getTranscript(videoId)
    ]);

    const [detailsResult, commentsResult, transcriptResult] = results;

    // Yadi video details fetch nahi ho paati to fatal error
    if (detailsResult.status === 'rejected') {
        const reason = detailsResult.reason?.message || 'Details fetch nahi ho sake';
        return `Fatal Error: ${reason}`;
    }
    const details = detailsResult.value;

    // Channel details fetch karne ki koshish karein
    let channelDetails = {};
    if (details.authorId) {
        try {
            channelDetails = await getChannelDetails(details.authorId);
        } catch (e) {
            console.error("Channel details fetch karne mein galti:", e.message);
        }
    }

    // Transcript ko process karein
    let transcriptText = "Transcript uplabdh nahi hai.";
    if (transcriptResult.status === 'fulfilled') {
        const transcriptLines = transcriptResult.value;
        if (Array.isArray(transcriptLines) && transcriptLines.length > 0) {
            transcriptText = transcriptLines.map(line => {
                const timestampInSeconds = (line.start ?? line.offset ?? 0) / 1000;
                return `(${formatTimestamp(timestampInSeconds)}) ${line.text.trim()}`;
            }).join('\n');
        }
    }

    // Top comments ko process karein
    let topCommentsText = "Koi comments uplabdh nahi ya fetch karne mein vifal.";
    if (commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value.comments)) {
        topCommentsText = commentsResult.value.comments
            .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
            .slice(0, 20)
            .map(c => `- **${c.author || 'Anonymous'}** (${formatNumber(c.likeCount)} likes): ${c.content ? c.content.trim() : ''}`)
            .join('\n');
    }

    // Download links generate aur format karein
    const streamLinks = generateStreamLinks(details);
    let downloadLinksText = "Download links generate nahi ho sake.";
    if (streamLinks) {
        const formatSection = (title, links) => {
            if (!links || links.length === 0) return '';
            return `\n**${title}:**\n` + links.map(l => `- ${l.quality} (${l.container})`).join('\n');
        };
        downloadLinksText = 
            formatSection('Video + Audio', streamLinks.combined) +
            formatSection('Video Only', streamLinks.videoOnly) +
            formatSection('Audio Only', streamLinks.audioOnly);
    }
    
    // Final report ko ek template string mein combine karein
    return `
**YouTube Video Vishleshan Report**

**1. Mool Jaankari:**
- **Title:** ${details.title || 'N/A'}
- **Views:** ${formatNumber(details.viewCount)}
- **Likes:** ${formatNumber(details.likeCount)}
- **Upload Tithi:** ${formatDate(details.published)}
- **Avadhi (Duration):** ${formatDuration(details.lengthSeconds)}

**2. Channel Vivaran:**
- **Channel Naam:** ${details.author || 'N/A'}
- **Subscribers:** ${formatNumber(channelDetails.subCount)}
- **Channel ID:** ${details.authorId || 'N/A'}

**3. Video Vivaran (Description):**
${details.description ? details.description.trim() : 'Koi vivaran nahi diya gaya.'}

**4. Video Transcript (Kya kaha ja raha hai):**
${transcriptText}

**5. Janta ki Rai (Top 20 Comments):**
${topCommentsText}

**6. Download aur Stream Links:**${downloadLinksText}

**--- Report Samapt ---**
    `.trim();
}


/**
 * ENDPOINT 4: /api/analyze_video - Video ki vishleshan report paane ke liye
 */
app.get('/api/analyze_video', async (req, res) => {
    const { v: videoId } = req.query;
    if (!videoId) {
        return res.status(400).json({ error: "Ek video ID zaroori hai." });
    }
    try {
        const report = await generateLlmReport(videoId);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(report);
    } catch (error) {
        res.status(500).send(`Ek anapekshit galti hui: ${error.message}`);
    }
});


/**
 * Ek search query ke liye vishleshan report banata hai.
 * @param {string} query - Search karne wala text.
 * @returns {Promise<Object>} - Search results ka structured object.
 */
async function generateLlmSearchReport(query) {
    const searchResults = await performSearch(query);
    if (!searchResults || searchResults.length === 0) {
        return { message: "Koi search results nahi mile.", results: [] };
    }

    const formattedResults = searchResults.map(item => {
        if (item.type === 'video') {
            const propertyMap = { liveNow: 'Live Now', isUpcoming: 'Upcoming', premium: 'Premium Content' };
            const specialProperties = Object.keys(propertyMap)
                .filter(key => item[key] === true)
                .map(key => propertyMap[key]);

            return {
                type: 'video',
                title: item.title,
                videoId: item.videoId,
                uploadDate: item.publishedText || 'N/A',
                views: formatNumber(item.viewCount),
                length: formatDuration(item.lengthSeconds),
                channelName: item.author,
                isVerified: item.authorVerified || false,
                specialProperties: specialProperties
            };
        } else if (item.type === 'channel') {
            return {
                type: 'channel',
                name: item.author,
                channelId: item.authorId,
                handle: item.channelHandle || 'N/A',
                isVerified: item.authorVerified || false,
                subscribers: formatNumber(item.subCount),
                videoCount: formatNumber(item.videoCount),
                description: item.description || 'Koi vivaran uplabdh nahi.'
            };
        } else if (item.type === 'playlist') {
            return {
                type: 'playlist',
                title: item.title,
                playlistId: item.playlistId,
                videoCount: item.videoCount,
                author: item.author,
            };
        }
        return null; // Anya types ko ignore karein
    }).filter(Boolean); // null entries ko hata dein

    return { results: formattedResults };
}

/**
 * ENDPOINT 5: /api/analyze_search - Search results ka vishleshan paane ke liye
 */
app.get('/api/analyze_search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) {
        return res.status(400).json({ error: "Ek search query 'q' zaroori hai." });
    }
    try {
        const report = await generateLlmSearchReport(query);
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: `Search ke dauran anapekshit galti hui: ${error.message}` });
    }
});


// ==========================================================
//  6. SERVER SHURU KAREIN
// ==========================================================
app.listen(PORT, () => {
    console.log(`🚀 Server http://localhost:${PORT} par chal raha hai`);
});
```
