// Listening Heart Monitor - Cloudflare Worker
// Monitor Listening Heart tasks for new notes and post Discord notifications

const LISTENING_HEART_URL = 'https://listening-heart.onrender.com';

// In-memory store (note: Workers have limits, use KV in production)
const subscriptions = new Map();
const seenNotes = new Map();

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
        value: (note.content?.substring(0, 1000)) || '(no content)',
        inline: false
      }
    ],
    timestamp: note.createdAt || new Date().toISOString(),
    footer: {
      text: 'Listening Heart Monitor'
    }
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
  } catch (error) {
    console.error('Failed to post to Discord:', error.message);
  }
}

// Poll a task for new notes
async function pollTask(taskId, webhookUrl) {
  try {
    const response = await fetch(`${LISTENING_HEART_URL}/tasks/${taskId}/notes`);
    const data = await response.json();
    const notes = data.notes || [];
    
    if (notes.length === 0) return;
    
    const seen = seenNotes.get(taskId) || new Set();
    
    for (const note of notes) {
      const noteKey = note.id || JSON.stringify(note);
      if (!seen.has(noteKey)) {
        console.log(`New note found for task ${taskId}`);
        await postToDiscord(webhookUrl, note, taskId);
        seen.add(noteKey);
      }
    }
    
    seenNotes.set(taskId, seen);
  } catch (error) {
    console.error(`Error polling task ${taskId}:`, error.message);
  }
}

// Cron trigger - called every 5 minutes
export default {
  async scheduled(event, env, ctx) {
    // Poll all subscriptions
    for (const [taskId, config] of subscriptions) {
      await pollTask(taskId, config.webhookUrl);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (request.method === 'OPTIONS') {
      return new Response('', { headers: corsHeaders });
    }

    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        subscriptions: subscriptions.size 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get subscriptions
    if (path === '/subscriptions' && request.method === 'GET') {
      const subs = {};
      for (const [taskId, config] of subscriptions) {
        subs[taskId] = { webhookUrl: '[REDACTED]' };
      }
      return new Response(JSON.stringify({ subscriptions: subs }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Subscribe endpoint (with x402 payment header check)
    if (path === '/subscribe' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      
      // Check for x402 payment header (simplified)
      if (!authHeader || !authHeader.startsWith('x402')) {
        return new Response(JSON.stringify({
          error: 'Payment required',
          message: 'x402 payment required',
          payment: {
            network: 'eip155:84532',
            currency: 'USDC',
            amount: '0.001'
          }
        }), {
          status: 402,
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'x402'
          }
        });
      }

      try {
        const { taskId, webhookUrl } = await request.json();
        
        if (!taskId || !webhookUrl) {
          return new Response(JSON.stringify({ 
            error: 'taskId and webhookUrl required' 
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
          return new Response(JSON.stringify({ 
            error: 'Invalid Discord webhook URL' 
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        subscriptions.set(taskId, { webhookUrl });
        
        // Initial poll
        await pollTask(taskId, webhookUrl);

        return new Response(JSON.stringify({
          success: true,
          message: `Subscribed to task ${taskId}`
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Unsubscribe
    if (path.startsWith('/subscribe/') && request.method === 'DELETE') {
      const taskId = path.split('/subscribe/')[1];
      subscriptions.delete(taskId);
      seenNotes.delete(taskId);
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: `Unsubscribed from ${taskId}` 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
