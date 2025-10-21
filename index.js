// ज़रूरी लाइब्रेरीज को इम्पोर्ट करें
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

// Express ऐप को इनिशियलाइज़ करें
const app = express();
const PORT = process.env.PORT || 3000;

// CORS मिडलवेयर का उपयोग करें ताकि कोई भी डोमेन इस API को एक्सेस कर सके
app.use(cors());

// होम रूट पर एक वेलकम मैसेज दिखाएं
app.get('/', (req, res) => {
    res.send('Welcome to the YouTube Transcript API! Use /api/transcript?v=VIDEO_ID to get the data.');
});


// एक GET रूट '/api/transcript' बनाएँ
app.get('/api/transcript', async (req, res) => {
    // URL से वीडियो ID (v) निकालें, जैसे: ?v=l58hKc239s8
    const { v } = req.query;

    // अगर वीडियो ID नहीं दी गई है, तो एरर भेजें
    if (!v) {
        return res.status(400).json({ error: 'YouTube video ID is required. Use the `v` query parameter.' });
    }

    try {
        // --- वीडियो और चैनल की डिटेल्स लाना ---
        const metadataUrl = `https://www.youtubetranscripts.tech/api/video?id=${v}`;

        // --- ट्रांसक्रिप्ट स्क्रैप करना ---
        const transcriptUrl = `https://youtubetotranscript.com/transcript?v=${v}`;
        
        // दोनों रिक्वेस्ट एक साथ भेजें ताकि समय बचे
        const [metadataResponse, transcriptResponse] = await Promise.all([
            axios.get(metadataUrl),
            axios.get(transcriptUrl)
        ]);

        // --- वीडियो डिटेल्स को प्रोसेस करें ---
        const metadata = metadataResponse.data;
        if (!metadata.valid) {
             return res.status(404).json({ error: 'Video not found or details could not be retrieved.' });
        }
        
        // --- ट्रांसक्रिप्ट को प्रोसेस करें ---
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

        // फाइनल JSON रिस्पॉन्स तैयार करें
        const finalResponse = {
            ...metadata,
            transcript: fullTranscript
        };

        // --- फाइनल JSON रिस्पॉन्स भेजें ---
        res.status(200).json(finalResponse);

    } catch (error) {
        // अगर कोई एरर आता है
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
