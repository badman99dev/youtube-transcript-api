const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/', (req, res) => {
    res.status(200).json({
        message: "Welcome to the YouTube Transcript & Details API!",
        usage: "Send a GET request to /api/transcript?v=YOUTUBE_VIDEO_ID",
        example: "/api/transcript?v=l58hKc239s8"
    });
});

app.get('/api/transcript', async (req, res) => {
    const { v } = req.query;

    if (!v) {
        return res.status(400).json({ success: false, error: 'YouTube video ID is required. Use the `v` query parameter.' });
    }

    const metadataUrl = `https://www.youtubetranscripts.tech/api/video?id=${v}`;
    const transcriptUrl = `https://youtubetotranscript.com/transcript?v=${v}`;

    try {
        const promises = [
            axios.get(metadataUrl),
            axios.get(transcriptUrl)
        ];
        
        const [metadataPromise, transcriptPromise] = await Promise.allSettled(promises);

        if (metadataPromise.status === 'rejected' || !metadataPromise.value.data.valid) {
            return res.status(404).json({ success: false, error: 'Video not found or details could not be retrieved.' });
        }
        const metadata = metadataPromise.value.data;
        
        // --- ट्रांसक्रिप्ट लॉजिक को यहाँ बदला गया है ---
        let transcriptArray = null; // null का मतलब है कि ट्रांसक्रिप्ट उपलब्ध नहीं है

        if (transcriptPromise.status === 'fulfilled') {
            const html = transcriptPromise.value.data;
            const $ = cheerio.load(html);
            const transcriptSegments = $('div#transcript span.transcript-segment');
            
            if (transcriptSegments.length > 0) {
                // खाली अरे बनाएँ
                transcriptArray = [];
                
                // हर हिस्से पर लूप चलाएँ
                transcriptSegments.each((index, element) => {
                    // टेक्स्ट और 'data-start' एट्रिब्यूट दोनों निकालें
                    const text = $(element).text().trim();
                    const start = $(element).attr('data-start');
                    
                    // अरे में ऑब्जेक्ट के रूप में डालें
                    transcriptArray.push({
                        text,
                        start
                    });
                });
            }
        } else {
            console.warn(`Could not fetch transcript for video ID ${v}:`, transcriptPromise.reason.message);
        }

        // --- फाइनल सफल रिस्पॉन्स भेजें ---
        res.status(200).json({
            success: true,
            ...metadata,
            transcript: transcriptArray // अब यह अरे है
        });

    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ success: false, error: 'An internal server error occurred.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
