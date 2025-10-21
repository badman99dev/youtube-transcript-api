const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS को इनेबल करें ताकि कोई भी फ्रंटएंड इसे कॉल कर सके
app.use(cors());

// होमपेज रूट (/) - यह बताएगा कि API का उपयोग कैसे करें
app.get('/', (req, res) => {
    res.status(200).json({
        message: "Welcome to the YouTube Transcript & Details API!",
        usage: "Send a GET request to /api/transcript?v=YOUTUBE_VIDEO_ID",
        example: "/api/transcript?v=l58hKc239s8"
    });
});

// मुख्य API रूट
app.get('/api/transcript', async (req, res) => {
    const { v } = req.query;

    if (!v) {
        return res.status(400).json({ success: false, error: 'YouTube video ID is required. Use the `v` query parameter.' });
    }

    const metadataUrl = `https://www.youtubetranscripts.tech/api/video?id=${v}`;
    const transcriptUrl = `https://youtubetotranscript.com/transcript?v=${v}`;

    try {
        // दोनों रिक्वेस्ट एक साथ भेजें, लेकिन अगर एक फेल हो तो भी दूसरी का इंतजार करें
        const promises = [
            axios.get(metadataUrl),
            axios.get(transcriptUrl)
        ];
        
        const [metadataPromise, transcriptPromise] = await Promise.allSettled(promises);

        // --- वीडियो डिटेल्स को प्रोसेस करें ---
        if (metadataPromise.status === 'rejected' || !metadataPromise.value.data.valid) {
            return res.status(404).json({ success: false, error: 'Video not found or details could not be retrieved.' });
        }
        const metadata = metadataPromise.value.data;
        
        // --- ट्रांसक्रिप्ट को प्रोसेस करें ---
        let fullTranscript = null; // null का मतलब है कि ट्रांसक्रिप्ट उपलब्ध नहीं है
        if (transcriptPromise.status === 'fulfilled') {
            const html = transcriptPromise.value.data;
            const $ = cheerio.load(html);
            const transcriptSegments = $('div#transcript span.transcript-segment');
            
            if (transcriptSegments.length > 0) {
                const allText = transcriptSegments.map((i, el) => $(el).text().trim()).get();
                fullTranscript = allText.join(' ');
            }
        } else {
            // अगर ट्रांसक्रिप्ट वाली साइट से एरर आए तो लॉग करें, पर API को फेल न करें
            console.warn(`Could not fetch transcript for video ID ${v}:`, transcriptPromise.reason.message);
        }

        // --- फाइनल सफल रिस्पॉन्स भेजें ---
        res.status(200).json({
            success: true,
            ...metadata,
            transcript: fullTranscript
        });

    } catch (error) {
        // अगर कोई अप्रत्याशित एरर आता है
        console.error('Unexpected error:', error);
        res.status(500).json({ success: false, error: 'An internal server error occurred.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
