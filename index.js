// ज़रूरी लाइब्रेरीज को इम्पोर्ट करें
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path'); // path मॉड्यूल को जोड़ें

// Express ऐप को इनिशियलाइज़ करें
const app = express();
const PORT = process.env.PORT || 3000;

// CORS मिडलवेयर का उपयोग करें
app.use(cors());

// --- नए रूट जोड़ें ---

// होम रूट पर एक वेलकम मैसेज दिखाएं
app.get('/', (req, res) => {
    res.send('Welcome! Go to /test to use the API tester.');
});

// टेस्टिंग पेज सर्व करने के लिए रूट
app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'test.html'));
});

// ----------------------

// एक GET रूट '/api/transcript' बनाएँ
app.get('/api/transcript', async (req, res) => {
    const { v } = req.query;

    if (!v) {
        return res.status(400).json({ error: 'YouTube video ID is required. Use the `v` query parameter.' });
    }

    try {
        const metadataUrl = `https://www.youtubetranscripts.tech/api/video?id=${v}`;
        const transcriptUrl = `https://youtubetotranscript.com/transcript?v=${v}`;
        
        const [metadataResponse, transcriptResponse] = await Promise.all([
            axios.get(metadataUrl),
            axios.get(transcriptUrl)
        ]);

        const metadata = metadataResponse.data;
        if (!metadata.valid) {
             return res.status(404).json({ error: 'Video not found or details could not be retrieved.' });
        }
        
        const html = transcriptResponse.data;
        const $ = cheerio.load(html);
        
        const transcriptSegments = $('div#transcript span.transcript-segment');
        
        let fullTranscript = "";
        if (transcriptSegments.length > 0) {
            const allText = [];
            transcriptSegments.each((index, element) => {
                allText.push($(element).text().trim());
            });
            fullTranscript = allText.join(' ');
        }

        const finalResponse = {
            ...metadata,
            transcript: fullTranscript
        };

        res.status(200).json(finalResponse);

    } catch (error) {
        console.error('Error fetching data:', error.message);
        res.status(500).json({ error: 'Failed to fetch transcript or video details. The video might not have a transcript or the external APIs might be down.' });
    }
});

// सर्वर को सुनना शुरू करें
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Vercel के लिए एक्सपोर्ट
module.exports = app;
