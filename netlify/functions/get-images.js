const https = require("https");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Slideshow/1.0",
        "Accept": "application/json",
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error("Invalid JSON: " + data.slice(0, 100))); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const slug = event.queryStringParameters && event.queryStringParameters.channel;

  if (!slug) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing channel slug" }),
    };
  }

  try {
    // Are.na API — fetch all blocks in the channel, paginated
    // First call to get total count
    const first = await fetchJson(`https://api.are.na/v2/channels/${slug}/contents?per=1`);

    if (!first || first.code === 404) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Channel not found. Make sure it's public and the slug is correct." }),
      };
    }

    const total = first.length || 0;
    const perPage = 100;
    const pages = Math.ceil(total / perPage);

    // Fetch all pages in parallel
    const pagePromises = [];
    for (let i = 1; i <= pages; i++) {
      pagePromises.push(
        fetchJson(`https://api.are.na/v2/channels/${slug}/contents?per=${perPage}&page=${i}`)
      );
    }
    const results = await Promise.all(pagePromises);

    // Collect only image blocks
    const images = [];
    for (const page of results) {
      const contents = page.contents || [];
      for (const block of contents) {
        // Only image blocks with a valid image URL
        if (block.class === "Image" && block.image) {
          // Prefer original > large > display size
          const url =
            (block.image.original && block.image.original.url) ||
            (block.image.large && block.image.large.url) ||
            (block.image.display && block.image.display.url);
          if (url) images.push(url);
        }
      }
    }

    if (images.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          images: [],
          note: "No images found in this channel. Make sure it's public and contains image blocks.",
        }),
      };
    }

    // Shuffle
    for (let i = images.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [images[i], images[j]] = [images[j], images[i]];
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ images, total: images.length }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
