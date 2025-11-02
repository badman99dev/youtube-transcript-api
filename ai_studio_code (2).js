// ==========================================================
//  1. SETUP AND IMPORTS
// ==========================================================

// Import necessary packages
const express = require('express'); // Web server framework
const cors = require('cors');       // To allow requests from other websites
const axios = require('axios');     // To make HTTP requests to other APIs

// Define constants for the application
const app = express();
const PORT = process.env.PORT || 3000; // Use port from environment or default to 3000
const INVIDIOUS_API_BASE = 'https://inv.perditum.com/api/v1';
const INVIDIOUS_DOMAIN = 'https://inv.perditum.com';

// Apply middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.static('public')); // Serve static files (like index.html) from the 'public' folder


// ==========================================================
//  2. UTILITY & FORMATTING HELPERS
// ==========================================================

/**
 * Parses a WebVTT format string into a structured array of transcript lines.
 * @param {string} vttString - The raw WebVTT text.
 * @returns {Array<Object>} An array of objects, each with 'start' (in ms) and 'text'.
 */
function parseWebVTT(vttString) {
    if (typeof vttString !== 'string') return [];
    const lines = vttString.split('\n');
    const transcript = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) {
            const timeParts = lines[i].split(' --> ');
            const startTimeString = timeParts[0];
            const timeSegments = startTimeString.split(':');
            const seconds = parseInt(timeSegments[0], 10) * 3600 + parseInt(timeSegments[1], 10) * 60 + parseFloat(timeSegments[2]);
            let text = '';
            let j = i + 1;
            while (j < lines.length && lines[j] !== '') { text += lines[j] + ' '; j++; }
            transcript.push({ start: seconds * 1000, text: text.trim() });
            i = j;
        }
    }
    return transcript;
}

const formatNumber = (num) => num != null ? new Intl.NumberFormat('en-US').format(num) : "N/A";
const formatDate = (dateString) => dateString ? new Date(dateString).toISOString().split('T')[0] : "N/A";
function formatDuration(totalSeconds) { if (totalSeconds == null || isNaN(totalSeconds)) return "N/A"; if (totalSeconds < 60) return `${totalSeconds} seconds`; const hours = Math.floor(totalSeconds / 3600); const minutes = Math.floor((totalSeconds % 3600) / 60); const seconds = totalSeconds % 60; const paddedMinutes = String(minutes).padStart(2, '0'); const paddedSeconds = String(seconds).padStart(2, '0'); if (hours > 0) return `${hours}:${paddedMinutes}:${paddedSeconds}`; return `${minutes}:${paddedSeconds}`; }
function formatTimestamp(totalSeconds) { if (totalSeconds == null || isNaN(totalSeconds)) return "00:00"; const hours = Math.floor(totalSeconds / 3600); const minutes = Math.floor((totalSeconds % 3600) / 60); const seconds = Math.floor(totalSeconds % 60); const paddedMinutes = String(minutes).padStart(2, '0'); const paddedSeconds = String(seconds).padStart(2, '0'); if (hours > 0) return `${hours}:${paddedMinutes}:${paddedSeconds}`; return `${minutes}:${paddedSeconds}`; }


// ==========================================================
//  3. CORE API DATA FETCHERS
// ==========================================================

async function getVideoDetails(videoId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}`); return response.data; }
async function getComments(videoId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/comments/${videoId}`); return response.data; }
async function getChannelDetails(channelId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/authors/${channelId}`); return response.data; }
async function performSearch(query) { const searchUrl = `${INVIDIOUS_API_BASE}/search?q=${encodeURIComponent(query)}`; const response = await axios.get(searchUrl); return response.data; }
async function getTranscript(videoId) { const captionsUrl = `${INVIDIOUS_API_BASE}/videos/${videoId}?fields=captions`; const captionsResponse = await axios.get(captionsUrl); const captions = captionsResponse.data.captions; if (!captions || captions.length === 0) { throw new Error("No captions available for this video."); } const transcriptPath = captions[0].url; const fullTranscriptUrl = `${INVIDIOUS_DOMAIN}${transcriptPath}`; const transcriptResponse = await axios.get(fullTranscriptUrl); const data = transcriptResponse.data; if (typeof data === 'string') return parseWebVTT(data); if (typeof data === 'object') { if (Array.isArray(data.captions)) return data.captions; if (Array.isArray(data.lines)) return data.lines; if (Array.isArray(data)) return data; } throw new Error("Could not parse transcript from the received data."); }


// ==========================================================
//  4. NEW LOGIC: Generate Download/Stream Links
// ==========================================================

/**
 * Takes the raw format data from Invidious and creates clean, usable link objects.
 * @param {Object} videoDetails - The full details object from the getVideoDetails call.
 * @returns {Object} An object containing categorized lists of stream links.
 */
function generateStreamLinks(videoDetails) {
    const videoId = videoDetails.videoId;
    const combined = [];
    const videoOnly = [];
    const audioOnly = [];

    // Process combined audio+video streams (usually lower quality)
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

    // Process adaptive formats (high quality video-only or audio-only)
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
                    quality: `${format.bitrate}bps`,
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
 * ENDPOINT 1: /api/fetch
 * A flexible endpoint to fetch raw, unprocessed data from Invidious.
 */
app.get('/api/fetch', async (req, res) => {
    const { id: videoId, channel: channelId, search: query } = req.query;
    const fields = req.query.fields ? req.query.fields.split(',').map(f => f.trim()) : [];
    if (!videoId && !channelId && !query) { return res.status(400).json({ error: "An 'id', 'channel', or 'search' parameter is required." }); }
    
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
        if (tasks.length === 0) { return res.status(400).json({ error: "No valid fields or parameters provided." }); }
        
        const results = await Promise.allSettled(tasks);
        const finalResponse = {};
        
        results.forEach((result, index) => {
            const key = responseKeys[index];
            if (result.status === 'fulfilled') { 
                finalResponse[key] = result.value; 
            } else { 
                finalResponse[key] = { error: `Failed to fetch ${key}`, details: result.reason?.message || 'Unknown error' }; 
            }
        });

        res.json(finalResponse);
    } catch (error) { 
        res.status(500).json({ error: "An unexpected server error occurred.", details: error.message }); 
    }
});


/**
 * ENDPOINT 2: /api/formats - NEW!
 * Gets a clean JSON object with all available download links for a video.
 */
app.get('/api/formats', async (req, res) => {
    const { v: videoId } = req.query;
    if (!videoId) { return res.status(400).json({ error: "A video ID 'v' is required." }); }
    try {
        const videoDetails = await getVideoDetails(videoId);
        const links = generateStreamLinks(videoDetails);
        res.json(links);
    } catch (error) {
        res.status(500).json({ error: `Failed to get formats: ${error.message}` });
    }
});


/**
 * ENDPOINT 3: /api/stream - NEW!
 * Acts as a high-speed proxy to stream video/audio content.
 */
app.get('/api/stream', async (req, res) => {
    const { v: videoId, itag } = req.query;
    if (!videoId || !itag) { return res.status(400).json({ error: "Both video ID 'v' and 'itag' are required." }); }

    try {
        // Construct the direct proxy URL to Invidious. `local=false` helps with speed.
        const streamUrl = `${INVIDIOUS_DOMAIN}/download?v=${videoId}&itag=${itag}&local=false`;

        // Make the request and tell axios to expect a stream of data
        const response = await axios({
            method: 'get',
            url: streamUrl,
            responseType: 'stream'
        });

        // Forward important headers from the Invidious response to our client
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Content-Length', response.headers['content-length']);
        
        // "Pipe" the video/audio data directly from Invidious to the user
        response.data.pipe(res);

    } catch (error) {
        res.status(500).send(`Error streaming content: ${error.message}`);
    }
});


/**
 * ENDPOINT 4: /api/analyze_search
 * Provides a clean, formatted JSON response for search results, suitable for an LLM.
 */
async function generateLlmSearchReport(query) {
    const searchResults = await performSearch(query);
    if (!searchResults || searchResults.length === 0) {
        return { message: "No search results found.", results: [] };
    }

    const formattedResults = searchResults.map(item => {
        if (item.type === 'video') {
            const propertyMap = { liveNow: 'Live Now', isUpcoming: 'Upcoming', premium: 'Premium Content', isNew: 'New Video', is4k: '4K Quality', is8k: '8K Quality', isVr180: 'VR180 Video', isVr360: '360° Video', is3d: '3D Video', hasCaptions: 'Has Captions' };
            const specialProperties = [];
            for (const key in propertyMap) { if (item[key] === true) { specialProperties.push(propertyMap[key]); } }
            return { type: 'video', title: item.title, videoId: item.videoId, uploadDate: item.publishedText || 'N/A', views: formatNumber(item.viewCount), length: formatDuration(item.lengthSeconds), channelName: item.author, isVerified: item.authorVerified || false, specialProperties: specialProperties };
        } else if (item.type === 'channel') {
            return { type: 'channel', name: item.author, channelId: item.authorId, handle: item.channelHandle || 'N/A', isVerified: item.authorVerified || false, subscribers: formatNumber(item.subCount), videoCount: formatNumber(item.videoCount), description: item.description || 'No description available.', };
        } else if (item.type === 'playlist') {
            return { type: 'playlist', title: item.title, playlistId: item.playlistId, videoCount: item.videoCount, author: item.author, };
        }
        return null;
    }).filter(Boolean);

    return { results: formattedResults };
}

app.get('/api/analyze_search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) { return res.status(400).json({ error: "A search query 'q' is required." }); }
    try {
        const report = await generateLlmSearchReport(query);
        res.json(report);
    } catch (error) { 
        res.status(500).json({ error: `An unexpected error occurred during search: ${error.message}` }); 
    }
});


/**
 * ENDPOINT 5: /api/analyze_video
 * Logic function to generate a clean, formatted text report for a single video.
 */
async function generateLlmReport(videoId) {
    const results = await Promise.allSettled([getVideoDetails(videoId), getComments(videoId), getTranscript(videoId)]);
    const [detailsResult, commentsResult, transcriptResult] = results;
    if (detailsResult.status === 'rejected') { const reason = detailsResult.reason?.message || 'Could not fetch details'; return `Fatal Error: ${reason}`; }
    const details = detailsResult.value;
    let channelDetails = {};
    if (details.authorId) { try { channelDetails = await getChannelDetails(details.authorId); } catch (e) {} }
    let transcriptText = "Transcript not available.";
    if (transcriptResult.status === 'fulfilled') {
        const transcriptLines = transcriptResult.value;
        if (Array.isArray(transcriptLines) && transcriptLines.length > 0) {
            transcriptText = transcriptLines.map(line => {
                const timestampInSeconds = (line.start ?? line.offset ?? 0) / 1000;
                const text = line.text || '';
                return `(${formatTimestamp(timestampInSeconds)}) ${text.trim()}`;
            }).join('\n');
        }
    }
    let topCommentsText = "No comments available or failed to fetch.";
    if (commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value.comments)) {
        topCommentsText = commentsResult.value.comments
            .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
            .slice(0, 20)
            .map(c => `- **${c.author || 'Anonymous'}** (${formatNumber(c.likeCount)} likes): ${c.content ? c.content.trim() : ''}`)
            .join('\n');
    }

    // --- NEW SECTION: Generate and format download links for the report ---
    const streamLinks = generateStreamLinks(details);
    let downloadLinksText = "Download links could not be generated.";
    if (streamLinks) {
        const formatSection = (title, links) => {
            if (!links || links.length === 0) return '';
            return `\n**${title}:**\n` + links.map(l => `- ${l.quality} (${l.container}): ${l.url}`).join('\n');
        };
        downloadLinksText = 
            formatSection('Video + Audio', streamLinks.combined) +
            formatSection('Video Only', streamLinks.videoOnly) +
            formatSection('Audio Only', streamLinks.audioOnly);
    }
    
    return `**YouTube Video Analysis Report**\n\n**1. Basic Information:**\n- **Title:** ${details.title || 'N/A'}\n- **Views:** ${formatNumber(details.viewCount)}\n- **Likes:** ${formatNumber(details.likeCount)}\n- **Uploaded On:** ${formatDate(details.published)}\n\n**2. Channel Details:**\n- **Channel Name:** ${details.author || 'N/A'}\n- **Subscribers:** ${formatNumber(channelDetails.subCount)}\n- **Channel ID:** ${details.authorId || 'N/A'}\n\n**3. Video Description:**\n${details.description ? details.description.trim() : 'No description provided.'}\n\n**4. Video Transcript (What is being said):**\n${transcriptText}\n\n**5. Public Opinion (Top 20 Comments):**\n${topCommentsText}\n\n**6. Download & Stream Links:**${downloadLinksText}\n\n**--- End of Report ---**`.trim();
}

app.get('/api/analyze_video', async (req, res) => {
    const { v: videoId } = req.query;
    if (!videoId) { return res.status(400).json({ error: "A video ID is required." }); }
    try { 
        const report = await generateLlmReport(videoId); 
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); 
        res.send(report); 
    } catch (error) { 
        res.status(500).send(`An unexpected server error occurred: ${error.message}`); 
    }
});


// ==========================================================
//  ✨ NEW WEB SEARCH ENDPOINT STARTS HERE ✨
// ==========================================================
app.get('/api/search', async (req, res) => {
    const { q: query } = req.query; // Get query from URL parameter ?q=...
  
    if (!query) {
      return res.status(400).json({ error: 'Search query (q) is required.' });
    }
  
    const options = {
      method: 'POST',
      url: 'https://perplexity2.p.rapidapi.com/',
      headers: {
        // IMPORTANT: Use Environment Variables on Vercel for your API key!
        'x-rapidapi-key': process.env.RAPIDAPI_KEY, 
        'x-rapidapi-host': 'perplexity2.p.rapidapi.com',
        'Content-Type': 'application/json'
      },
      data: {
        content: query // Use the dynamic query from the user
      }
    };
  
    try {
      const response = await axios.request(options);
      
      const mainResponse = response.data;
      const answer = mainResponse.choices?.content?.parts?.[0]?.text || "No answer found.";
      const sources = mainResponse.groundingMetadata?.groundingChunks?.map(chunk => ({
          title: chunk.web.title,
          url: chunk.web.uri
      })) || [];
  
      res.json({
          answer,
          sources
      });
  
    } catch (error) {
      console.error('RapidAPI Error:', error.response ? error.response.data : error.message);
      res.status(500).json({ error: 'Failed to fetch search results from the API.', details: error.message });
    }
});


// ==========================================================
//  6. START THE SERVER
// ==========================================================
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});