const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- हेल्पर फंक्शन: सेकंड को [MM:SS] फॉर्मेट में बदलने के लिए ---
function formatTimestamp(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const pad = (num) => String(num).padStart(2, '0');
    return `[${pad(minutes)}:${pad(seconds)}]`;
}

app.get('/', (req, res) => {
    res.status(200).json({
        message: "Welcome to the YouTube Transcript API!",
        usage: "Send a GET request to /api/transcript?v=YOUTUBE_VIDEO_ID",
        example: "/api/transcript?v=l58hKc239s8"
    });
});

app.get('/api/transcript', async (req, res) => {
    const { v } = req.query;

    if (!v) {
        return res.status(400).json({ success: false, error: 'YouTube video ID is required.' });
    }

    const metadataUrl = `https://www.youtubetranscripts.tech/api/video?id=${v}`;
    const transcriptUrl = `https://youtubetotranscript.com/transcript?v=${v}`;

    try {
        const [metadataPromise, transcriptPromise] = await Promise.allSettled([
            axios.get(metadataUrl),
            axios.get(transcriptUrl)
        ]);

        if (metadataPromise.status === 'rejected' || !metadataPromise.value.data.valid) {
            return res.status(404).json({ success: false, error: 'Video not found or details invalid.' });
        }
        const rawData = metadataPromise.value.data;
        
        // --- ट्रांसक्रिप्ट को प्रोसेस करें ---
        let formattedTranscript = null;

        if (transcriptPromise.status === 'fulfilled') {
            const html = transcriptPromise.value.data;
            const $ = cheerio.load(html);
            const segments = $('div#transcript span.transcript-segment');
            
            if (segments.length > 0) {
                const lines = segments.map((i, el) => {
                    const startSeconds = parseFloat($(el).attr('data-start'));
                    const text = $(el).text().trim();
                    const timestamp = formatTimestamp(startSeconds);
                    return `${timestamp} ${text}`;
                }).get();
                
                formattedTranscript = lines.join('\n'); // लाइनों को नई लाइन से जोड़ें
            }
        } else {
            console.warn(`Could not fetch transcript for video ID ${v}`);
        }

        // --- फाइनल, सरल रिस्पॉन्स बनाएँ ---
        const finalResponse = {
            success: true,
            videoId: v,
            fetchedAt: new Date().toISOString(),
            title: rawData.title,
            thumbnail: rawData.thumbnail,
            duration: rawData.durationFormatted,
            uploadDate: rawData.uploadDate,
            channelTitle: rawData.channelTitle,
            channelSubscribers: rawData.channelSubscribers,
            viewCount: rawData.viewCount,
            likeCount: rawData.likeCount,
            transcript: formattedTranscript
        };

        res.status(200).json(finalResponse);

    } catch (error)
    {
        console.error('Unexpected error:', error);
        res.status(500).json({ success: false, error: 'An internal server error occurred.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
