const login = require('daiki-fca');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

if (!process.env.APPSTATE || !process.env.GEMINI_API_KEY) {
  throw new Error('Missing required environment variables: APPSTATE or GEMINI_API_KEY');
}

const appState = process.env.APPSTATE;
const geminiApiKey = process.env.GEMINI_API_KEY;

const font = {
    bold: (text) => {
        const boldMap = {
            'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴', 'h': '𝗵', 'i': '𝗶', 'j': '𝗷',
            'k': '𝗸', 'l': '𝗹', 'm': '𝗺', 'n': '𝗻', 'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁',
            'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
            'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗚', 'H': '𝗛', 'I': '𝗜', 'J': '𝗝',
            'K': '𝗞', 'L': '𝗟', 'M': '𝗠', 'N': '𝗡', 'O': '𝗢', 'P': '𝗣', 'Q': '𝗤', 'R': '𝗥', 'S': '𝗦', 'T': '𝗧',
            'U': '𝗨', 'V': '𝗩', 'W': '𝗪', 'X': '𝗫', 'Y': '𝗬', 'Z': '𝗭',
            '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
        };
        return text.split('').map(char => boldMap[char] || char).join('');
    }
};

login({ appState }, (err, api) => {
  if (err) return console.error(err);
  api.setOptions({ listenEvents: true });
  api.listenMqtt(async (err, event) => {
    if (err) return console.error(err);
    if (event.type === 'message' && event.body && event.body.toLowerCase().startsWith('ai')) {
      const prompt = event.body.slice(2).trim();
      if (prompt.toLowerCase().startsWith('imagine')) {
        const imagePrompt = prompt.slice(7).trim();
        try {
          const tempFilePath = path.join("attach", `temp_image_${Date.now()}.jpg`);
          const response = await axios({
            method: 'get',
            url: `https://image.pollinations.ai/prompt/${imagePrompt}`,
            responseType: 'stream'
          });
          const writer = fs.createWriteStream(tempFilePath);
          response.data.pipe(writer);
          await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
          const fileData = fs.createReadStream(tempFilePath);
          api.sendMessage({ attachment: fileData }, event.threadID);
          fs.unlink(tempFilePath, (unlinkErr) => {
            if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
          });
        } catch (error) {
          api.sendMessage(`Error generating image: ${error.message}`, event.threadID);
        }
      } else if (event.messageReply && event.messageReply.attachments && event.messageReply.attachments[0]?.type === "photo") {
        const attachment = event.messageReply.attachments[0];
        const imageUrl = attachment.url;
        try {
          const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
          const imageData = Buffer.from(imageResponse.data, 'binary').toString('base64');

          const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
            {
              contents: [
                {
                  parts: [
                    { text: prompt },
                    {
                      inline_data: {
                        mime_type: "image/jpeg",
                        data: imageData
                      }
                    }
                  ]
                }
              ],
              generation_config: {
                temperature: 0.4,
                max_output_tokens: 2048
              }
            }
          );

          if (response.data && response.data.candidates && response.data.candidates[0]) {
            api.sendMessage(response.data.candidates[0].content.parts[0].text.replace(/\*\*(.*?)\*\*/g, (_, text) => font.bold(text)), event.threadID);
          } else {
            api.sendMessage("No valid response from Gemini Vision API", event.threadID);
          }
        } catch (error) {
          api.sendMessage(`Error processing image and question: ${error.message}`, event.threadID);
        }
      } else {
        try {
          const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
            {
              contents: [
                {
                  parts: [
                    { text: prompt }
                  ]
                }
              ],
              generation_config: {
                temperature: 0.7,
                max_output_tokens: 2048
              }
            }
          );

          if (response.data && response.data.candidates && response.data.candidates[0]) {
            api.sendMessage(response.data.candidates[0].content.parts[0].text.replace(/\*\*(.*?)\*\*/g,(_, text) => font.bold(text)), event.threadID);
          } else {
            api.sendMessage("No valid response from Gemini API", event.threadID);
          }
        } catch (error) {
          api.sendMessage(`Error processing your request: ${error.message}`, event.threadID);
        }
      }
    }
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});