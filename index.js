// ==========================================================
//  1. SETUP AND IMPORTS
// ==========================================================

// Import necessary packages
const express = require('express'); // Web server framework
const cors = require('cors');       // To allow requests from other websites
const axios = require('axios');     // To make HTTP requests to the Invidious API

// Define constants for the application
const app = express();
const PORT = process.env.PORT || 3000; // Use port from environment or default to 3000
const INVIDIOUS_API_BASE = 'https://inv.perditum.com/api/v1';
const INVIDIOUS_DOMAIN = 'https://inv.perditum.com';

// Apply middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.static('public')); // Serve static files (like index.html or test.html) from the 'public' folder


// ==========================================================
//  2. UTILITY & FORMATTING HELPERS
// ==========================================================

/**
 * Parses a WebVTT format string into a structured array of transcript lines.
 * @param {string} vttString - The raw WebVTT text.
 * @returns {Array<Object>} An array of objects, each with 'start' (in ms) and 'text'.
 */
function parseWebVTT(vttString) {
    if (typeof vttString !== 'string') {
        return [];
    }

    const lines = vttString.split('\n');
    const transcript = [];

    for (let i = 0; i < lines.length; i++) {
        // Find the timestamp line (e.g., "00:01:05.240 --> 00:01:07.880")
        if (lines[i].includes('-->')) {
            const timeParts = lines[i].split(' --> ');
            const startTimeString = timeParts[0];

            // Convert time string to total seconds
            const timeSegments = startTimeString.split(':');
            const seconds = parseInt(timeSegments[0], 10) * 3600 +
                            parseInt(timeSegments[1], 10) * 60 +
                            parseFloat(timeSegments[2]);
            
            // The actual transcript text is on the next line(s)
            let text = '';
            let j = i + 1;
            while (j < lines.length && lines[j] !== '') {
                text += lines[j] + ' ';
                j++;
            }

            transcript.push({
                start: seconds * 1000, // Convert to milliseconds for consistency
                text: text.trim()
            });

            i = j; // Skip the lines we've already processed
        }
    }
    return transcript;
}

/**
 * Formats a number with commas (e.g., 1000000 -> "1,000,000").
 * @param {number} num - The number to format.
 * @returns {string} The formatted number string or "N/A".
 */
const formatNumber = (num) => num != null ? new Intl.NumberFormat('en-US').format(num) : "N/A";

/**
 * Formats a date string into "YYYY-MM-DD" format.
 * @param {string} dateString - An ISO date string.
 * @returns {string} The formatted date string or "N/A".
 */
const formatDate = (dateString) => dateString ? new Date(dateString).toISOString().split('T')[0] : "N/A";

/**
 * Formats a duration from total seconds into a human-readable string (MM:SS or H:MM:SS).
 * @param {number} totalSeconds - The total duration in seconds.
 * @returns {string} The formatted duration string.
 */
function formatDuration(totalSeconds) {
    if (totalSeconds == null || isNaN(totalSeconds)) return "N/A";
    if (totalSeconds < 60) return `${totalSeconds} seconds`;

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(seconds).padStart(2, '0');

    if (hours > 0) {
        return `${hours}:${paddedMinutes}:${paddedSeconds}`;
    } else {
        return `${minutes}:${paddedSeconds}`;
    }
}

/**
 * Formats a transcript timestamp from total seconds into a human-readable string (MM:SS or H:MM:SS).
 * @param {number} totalSeconds - The total timestamp in seconds.
 * @returns {string} The formatted timestamp string.
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
    } else {
        return `${minutes}:${paddedSeconds}`;
    }
}


// ==========================================================
//  3. CORE API DATA FETCHERS
// ==========================================================

async function getVideoDetails(videoId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/videos/${videoId}`); return response.data; }
async function getComments(videoId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/comments/${videoId}`); return response.data; }
async function getChannelDetails(channelId) { const response = await axios.get(`${INVIDIOUS_API_BASE}/authors/${channelId}`); return response.data; }

/**
 * Performs a search on Invidious for videos, channels, and playlists.
 * @param {string} query - The search term.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of search results.
 */
async function performSearch(query) {
    const searchUrl = `${INVIDIOUS_API_BASE}/search?q=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl);
    return response.data;
}

/**
 * Fetches the transcript for a given video ID.
 * This function is robust and handles both JSON and WebVTT text formats from Invidious.
 * @param {string} videoId - The YouTube video ID.
 * @returns {Promise<Array<Object>>} A promise that resolves to a clean array of transcript lines.
 */
async function getTranscript(videoId) {
    // Step 1: Get the list of available captions
    const captionsUrl = `${INVIDIOUS_API_BASE}/videos/${videoId}?fields=captions`;
    const captionsResponse = await axios.get(captionsUrl);
    const captions = captionsResponse.data.captions;

    if (!captions || captions.length === 0) {
        throw new Error("No captions available for this video.");
    }

    // Step 2: Fetch the actual transcript file from the URL provided
    const transcriptPath = captions[0].url;
    const fullTranscriptUrl = `${INVIDIOUS_DOMAIN}${transcriptPath}`;
    const transcriptResponse = await axios.get(fullTranscriptUrl);
    const data = transcriptResponse.data;

    // Step 3: Check if the response is a raw text (WebVTT) or a JSON object and process it
    if (typeof data === 'string') {
        return parseWebVTT(data); // If it's text, parse it
    } else if (typeof data === 'object') {
        // If it's an object, find the array of lines within it
        if (Array.isArray(data.captions)) return data.captions;
        if (Array.isArray(data.lines)) return data.lines;
        if (Array.isArray(data)) return data;
    }

    throw new Error("Could not parse transcript from the received data.");
}


// ==========================================================
//  4. PUBLIC API ENDPOINTS
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
 * ENDPOINT 2: /api/analyze_video
 * Logic function to generate a clean, formatted text report for a single video.
 */
async function generateLlmReport(videoId) {
    // Fetch all data in parallel
    const results = await Promise.allSettled([
        getVideoDetails(videoId),
        getComments(videoId),
        getTranscript(videoId)
    ]);
    const [detailsResult, commentsResult, transcriptResult] = results;

    // A report is useless without video details, so this is a fatal error.
    if (detailsResult.status === 'rejected') {
        const reason = detailsResult.reason?.message || 'Could not fetch video details';
        return `Fatal Error: ${reason}`;
    }
    const details = detailsResult.value;

    // Safely fetch channel details; if it fails, we can still continue.
    let channelDetails = {};
    if (details.authorId) {
        try { channelDetails = await getChannelDetails(details.authorId); } catch (e) {}
    }
    
    // Safely format the transcript
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

    // Safely format top comments
    let topCommentsText = "No comments available or failed to fetch.";
    if (commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value.comments)) {
        topCommentsText = commentsResult.value.comments
            .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
            .slice(0, 3)
            .map(c => `- **Top Comment (${formatNumber(c.likeCount)} likes):** ${c.content ? c.content.trim() : ''}`)
            .join('\n');
    }

    // Assemble the final report string
    return `**YouTube Video Analysis Report**\n\n**1. Basic Information:**\n- **Title:** ${details.title || 'N/A'}\n- **Views:** ${formatNumber(details.viewCount)}\n- **Likes:** ${formatNumber(details.likeCount)}\n- **Uploaded On:** ${formatDate(details.published)}\n\n**2. Channel Details:**\n- **Channel Name:** ${details.author || 'N/A'}\n- **Subscribers:** ${formatNumber(channelDetails.subCount)}\n- **Channel ID:** ${details.authorId || 'N/A'}\n\n**3. Video Description:**\n${details.description ? details.description.trim() : 'No description provided.'}\n\n**4. Video Transcript (What is being said):**\n${transcriptText}\n\n**5. Public Opinion (Top Comments Summary):**\n${topCommentsText}\n\n**--- End of Report ---**`.trim();
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


/**
 * ENDPOINT 3: /api/analyze_search
 * Logic function to generate a clean, formatted JSON response for search results.
 */
async function generateLlmSearchReport(query) {
    const searchResults = await performSearch(query);
    if (!searchResults || searchResults.length === 0) {
        return { message: "No search results found.", results: [] };
    }

    const formattedResults = searchResults.map(item => {
        // Case 1: The item is a VIDEO
        if (item.type === 'video') {
            const propertyMap = {
                liveNow: 'Live Now', isUpcoming: 'Upcoming', premium: 'Premium Content',
                isNew: 'New Video', is4k: '4K Quality', is8k: '8K Quality',
                isVr180: 'VR180 Video', isVr360: '360° Video', is3d: '3D Video',
                hasCaptions: 'Has Captions'
            };
            const specialProperties = [];
            for (const key in propertyMap) {
                if (item[key] === true) {
                    specialProperties.push(propertyMap[key]);
                }
            }
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
        } 
        // Case 2: The item is a CHANNEL
        else if (item.type === 'channel') {
            return {
                type: 'channel',
                name: item.author,
                channelId: item.authorId,
                handle: item.channelHandle || 'N/A',
                isVerified: item.authorVerified || false,
                subscribers: formatNumber(item.subCount),
                videoCount: formatNumber(item.videoCount),
                description: item.description || 'No description available.',
            };
        }
        // Case 3: The item is a PLAYLIST
        else if (item.type === 'playlist') {
             return {
                type: 'playlist',
                title: item.title,
                playlistId: item.playlistId,
                videoCount: item.videoCount,
                author: item.author,
            };
        }
        return null; // Ignore any other types
    }).filter(Boolean); // Remove any null entries

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


// ==========================================================
//  5. START THE SERVER
// ==========================================================
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
