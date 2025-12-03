import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

// Enable CORS for all origins
app.use(cors());

// PERFORMANCE OPTIMIZATION: In-memory cache
let pagesCache = new Map(); // Use Map for O(1) lookups instead of O(n)
let pagesLoadedAt = null;

async function loadPagesIntoCache() {
  try {
    const url = `https://faltapoco.com/pages.json?t=${Date.now()}`; // cache-busting
    const res = await fetch(url);

    if (!res.ok) throw new Error("Failed to fetch remote pages.json");

    const pages = await res.json();

    pagesCache.clear();
    Object.entries(pages).forEach(([key, pageData]) => {
      pagesCache.set(pageData.meta.slug, pageData);
    });

    pagesLoadedAt = new Date();
    console.log(`✅ Loaded ${pagesCache.size} pages from remote JSON`);

    return pagesCache;

  } catch (err) {
    console.error("❌ Error loading remote pages.json:", err);
    throw err;
  }
}

// Calculate time left from target date
function calcTimeLeft(targetIso) {
  const now = new Date();
  const target = new Date(targetIso);
  const diff = target - now;

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { days, hours, minutes, seconds };
}

// API endpoint to get countdown data for a specific event
app.get('/api/countdown/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;

    // Fast O(1) lookup from Map instead of O(n) array search
    const pageData = pagesCache.get(slug);

    if (!pageData) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const timeLeft = calcTimeLeft(pageData.date.targetIso);

    // Add cache headers - cache for 5 seconds to reduce load
    // This is reasonable since countdown changes every second anyway
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.setHeader('X-Cache-Status', pagesLoadedAt ? 'HIT' : 'MISS');

    res.json({
      slug: pageData.meta.slug,
      title: pageData.content.title,
      targetDate: pageData.date.targetIso,
      timeLeft,
      description: pageData.content.info?.[0] || '',
      url: pageData.meta.url
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint to serve embeddable HTML widget
app.get('/api/embed/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;

    // Fast O(1) lookup from Map
    const pageData = pagesCache.get(slug);

    if (!pageData) {
      return res.status(404).send('Event not found');
    }

    const timeLeft = calcTimeLeft(pageData.date.targetIso);

    // Generate embeddable HTML with inline styles matching the Counter.astro design
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contador - ${pageData.content.title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: transparent;
    }
    .countdown-container {
      padding: 2rem;
      background: white;
      border-radius: 0.5rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      text-align: center;
      max-width: 600px;
      margin: 0 auto;
    }
    .countdown-title {
      font-size: 1.5rem;
      font-weight: 600;
      color: #FFDD00;
      margin-bottom: 1rem;
    }
    .countdown-display {
      font-size: 3rem;
      font-weight: bold;
      color: #0B5FFF;
      font-family: 'Courier New', monospace;
      margin: 1rem 0;
    }
    .countdown-description {
      font-size: 1rem;
      color: #6B7280;
      margin-top: 0.5rem;
    }
    @media (max-width: 640px) {
      .countdown-display {
        font-size: 2rem;
      }
      .countdown-title {
        font-size: 1.25rem;
      }
    }
  </style>
</head>
<body>
  <div class="countdown-container">
    <div class="countdown-title">${pageData.content.timeLeft}</div>
    <div class="countdown-display" id="countdown">
      ${timeLeft.days}d ${String(timeLeft.hours).padStart(2, '0')}h ${String(timeLeft.minutes).padStart(2, '0')}m ${String(timeLeft.seconds).padStart(2, '0')}s
    </div>
    <div class="countdown-description">
      ${pageData.content.info?.[0] || ''}
    </div>
  </div>
  <script>
    const targetDate = new Date('${pageData.date.targetIso}');
    
    function updateCountdown() {
      const now = new Date();
      const diff = targetDate - now;
      
      if (diff <= 0) {
        document.getElementById('countdown').textContent = '¡Evento iniciado!';
        return;
      }
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      document.getElementById('countdown').textContent = 
        days + 'd ' + 
        String(hours).padStart(2, '0') + 'h ' + 
        String(minutes).padStart(2, '0') + 'm ' + 
        String(seconds).padStart(2, '0') + 's';
    }
    
    // Update every second
    setInterval(updateCountdown, 1000);
    updateCountdown();
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'public, max-age=10'); // Cache HTML for 10 seconds
    res.send(html);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Internal server error');
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cachedPages: pagesCache.size,
    cacheLoadedAt: pagesLoadedAt?.toISOString() || null
  });
});

// GET /api/pages - List all pages info for frontend
app.get('/api/pages', (req, res) => {
  // Return array of { slug, title, description, url }
  const pages = Array.from(pagesCache.values()).map(page => ({
    slug: page.meta.slug,
    title: page.content.title,
    description: page.content.info?.[0] || '',
    url: page.meta.url
  }));
  res.json(pages);
});

// Endpoint to reload cache (useful for updates without restart)
app.post('/api/reload-cache', async (req, res) => {
  try {
    await loadPagesIntoCache();
    res.json({
      success: true,
      message: 'Cache reloaded successfully',
      pages: pagesCache.size
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server and load cache
async function startServer() {
  try {
    // Load pages into cache before starting server
    await loadPagesIntoCache();

    app.listen(PORT, () => {
      console.log(`🚀 Countdown API server running on http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`📅 Example: http://localhost:${PORT}/api/countdown/navidad`);
      console.log(`🎨 Embed example: http://localhost:${PORT}/api/embed/navidad`);
      console.log(`🔄 Reload cache: POST http://localhost:${PORT}/api/reload-cache`);
      console.log(`\n⚡ Performance mode: Using in-memory cache with ${pagesCache.size} pages`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
