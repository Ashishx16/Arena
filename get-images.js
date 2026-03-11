const https = require("https");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: null, raw: data.slice(0, 300) }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// Pull image URL out of a block — handles different API response shapes
function getImageUrl(block) {
  // Shape 1: block.image.original.url (V2 documented)
  if (block.image) {
    if (block.image.original && block.image.original.url) return block.image.original.url;
    if (block.image.large    && block.image.large.url)    return block.image.large.url;
    if (block.image.display  && block.image.display.url)  return block.image.display.url;
    if (block.image.square   && block.image.square.url)   return block.image.square.url;
    // Sometimes image is just a string URL
    if (typeof block.image === "string") return block.image;
  }
  // Shape 2: block.attachment.url (some V3 responses)
  if (block.attachment && block.attachment.url) return block.attachment.url;
  // Shape 3: block.source.url for linked images
  if (block.source && block.source.url && /\.(jpg|jpeg|png|webp|gif)/i.test(block.source.url)) {
    return block.source.url;
  }
  return null;
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const slug = event.queryStringParameters && event.queryStringParameters.channel;
  const debug = event.queryStringParameters && event.queryStringParameters.debug === "1";

  if (!slug) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing channel slug" }) };
  }

  try {
    // Step 1: fetch channel metadata to get total block count
    const channelRes = await fetchJson(`https://api.are.na/v2/channels/${slug}`);

    if (channelRes.status === 404 || !channelRes.body) {
      return {
        statusCode: 404, headers,
        body: JSON.stringify({
          error: "Channel not found.",
          hint: "Check your slug is correct and the channel is set to Open or Public on Are.na.",
          slug,
          apiStatus: channelRes.status,
        }),
      };
    }

    const channel = channelRes.body;
    const total = channel.length || 0;

    if (debug) {
      // Return raw channel info so we can inspect the structure
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          debug: true,
          channelTitle: channel.title,
          channelStatus: channel.status,
          totalBlocks: total,
          sampleBlock: channel.contents && channel.contents[0],
        }),
      };
    }

    if (total === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ images: [], note: "Channel is empty." }),
      };
    }

    // Step 2: fetch all pages
    const perPage = 100;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const pagePromises = [];
    for (let i = 1; i <= pages; i++) {
      pagePromises.push(fetchJson(`https://api.are.na/v2/channels/${slug}/contents?per=${perPage}&page=${i}`));
    }
    const results = await Promise.all(pagePromises);

    const images = [];
    let totalBlocks = 0;
    let imageBlocks = 0;

    for (const result of results) {
      const contents = result.body && (result.body.contents || result.body);
      if (!Array.isArray(contents)) continue;

      for (const block of contents) {
        totalBlocks++;
        // Are.na image blocks have class "Image" or type "Image"
        const isImage = block.class === "Image" || block.type === "Image" ||
                        block.base_class === "Block" && block.image;
        if (isImage) {
          imageBlocks++;
          const url = getImageUrl(block);
          if (url) images.push(url);
        }
      }
    }

    if (images.length === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          images: [],
          note: `Found ${totalBlocks} blocks but ${imageBlocks} image blocks had no usable URL. Try ?debug=1 to inspect.`,
        }),
      };
    }

    // Shuffle
    for (let i = images.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [images[i], images[j]] = [images[j], images[i]];
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ images, total: images.length }),
    };

  } catch (err) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
