const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const LISTENING_HEART_URL = process.env.LISTENING_HEART_URL || 'https://listening-heart.onrender.com';

// In-memory store for subscriptions (in production, use a database)
const subscriptions = new Map();

// Track seen notes per task
const seenNotes = new Map();

// x402 payment verification (simplified - checks for USDC payment on Base Sepolia)
// In production, you'd verify the actual transaction on-chain
async function verifyX402Payment(authHeader) {
  if (!authHeader || !authHeader.startsWith('x402-')) {
    return false;
  }
  // The x402 protocol includes payment info in the Authorization header
  // For now, we accept any valid x402 header as payment proof
  // Real implementation would verify the actual transaction
  return true;
}

// Truncate Ethereum address
function truncateAddress(address) {
  if (!address) return 'Unknown';
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Post notification to Discord
async function postToDiscord(webhookUrl, note, taskId) {
  if (!webhookUrl) return;
  
  const embed = {
    title: `📝 New Note on Task ${taskId.slice(0, 8)}...`,
    color: 0x00ff00,
    fields: [
      {
        name: 'Author',
        value: truncateAddress(note.author || note.authorAddress),
        inline: true
      },
      {
        name: 'Type',
        value: note.type || 'feedback',
        inline: true
      },
      {
        name: 'Content',
        value: note.content?.substring(0, 1000) || '(no content)',
        inline: false
      }
    ],
    timestamp: note.createdAt || new Date().toISOString(),
    footer: {
      text: 'Listening Heart Monitor'
    }
  };

  try {
    await axios.post(webhookUrl, {
      embeds: [embed]
    });
    console.log(`[${new Date().toISOString()}] Posted notification for note to Discord`);
  } catch (error) {
    console.error('Failed to post to Discord:', error.message);
  }
}

// Poll a task for new notes
async function pollTask(taskId, webhookUrl) {
  try {
    const response = await axios.get(`${LISTENING_HEART_URL}/tasks/${taskId}/notes`);
    const notes = response.data.notes || [];
    
    if (notes.length === 0) return;
    
    // Get previously seen notes
    const seen = seenNotes.get(taskId) || new Set();
    
    // Check for new notes
    for (const note of notes) {
      const noteKey = note.id || JSON.stringify(note);
      if (!seen.has(noteKey)) {
        console.log(`[${new Date().toISOString()}] New note found for task ${taskId}`);
        await postToDiscord(webhookUrl, note, taskId);
        seen.add(noteKey);
      }
    }
    
    seenNotes.set(taskId, seen);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error polling task ${taskId}:`, error.message);
  }
}

// Start polling for all subscriptions
function startPolling() {
  setInterval(async () => {
    for (const [taskId, config] of subscriptions) {
      await pollTask(taskId, config.webhookUrl);
    }
  }, 5 * 60 * 1000); // Every 5 minutes
  
  console.log(`[${new Date().toISOString()}] Polling started - checking every 5 minutes`);
}

// Subscribe endpoint (with x402 payment)
app.post('/subscribe', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  // Verify x402 payment
  const isPaid = await verifyX402Payment(authHeader);
  if (!isPaid) {
    res.set('WWW-Authenticate', 'x402');
    return res.status(402).json({
      error: 'Payment required',
      message: 'x402 payment of 0.001 USDC on Base Sepolia required',
      payment: {
        network: 'eip155:84532',
        currency: 'USDC',
        amount: '0.001',
        recipient: '0x...'
      }
    });
  }

  const { taskId, webhookUrl } = req.body;
  
  if (!taskId || !webhookUrl) {
    return res.status(400).json({ error: 'taskId and webhookUrl are required' });
  }
  
  // Validate webhook URL format
  if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    return res.status(400).json({ error: 'Invalid Discord webhook URL' });
  }
  
  subscriptions.set(taskId, { webhookUrl, createdAt: new Date().toISOString() });
  
  // Initial poll
  await pollTask(taskId, webhookUrl);
  
  console.log(`[${new Date().toISOString()}] Subscribed to task ${taskId}`);
  
  res.json({
    success: true,
    message: `Subscribed to task ${taskId}`,
    pollInterval: '5 minutes'
  });
});

// Unsubscribe endpoint
app.delete('/subscribe/:taskId', (req, res) => {
  const { taskId } = req.params;
  subscriptions.delete(taskId);
  seenNotes.delete(taskId);
  console.log(`[${new Date().toISOString()}] Unsubscribed from task ${taskId}`);
  res.json({ success: true, message: `Unsubscribed from task ${taskId}` });
});

// Get subscriptions (for debugging)
app.get('/subscriptions', (req, res) => {
  const subs = {};
  for (const [taskId, config] of subscriptions) {
    subs[taskId] = { ...config, webhookUrl: '[REDACTED]' };
  }
  res.json({ subscriptions: subs });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', subscriptions: subscriptions.size });
});

// Start server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Listening Heart Monitor running on port ${PORT}`);
  startPolling();
});
