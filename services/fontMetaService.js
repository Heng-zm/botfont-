// services/fontMetaService.js

const opentype = require('opentype.js');
const path = require('path');
const { logger } = require('./logger');

// --- Configuration Constants ---
const MAX_CAPTION_LENGTH = 1024; // Telegram API limit for captions
const TRUNCATE_LIMITS = {
    DEFAULT: 50,
    COPYRIGHT: 250,
};
const NOT_AVAILABLE = 'N/A';

/**
 * Safely truncates a string to a specified maximum length, appending '...'.
 * @param {string} text The text to truncate.
 * @param {number} maxLength The maximum allowed length.
 * @returns {string} The original or truncated text.
 */
function truncate(text, maxLength) {
    if (typeof text !== 'string' || text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Reads and parses metadata from a font file using opentype.js.
 * @param {string} fontPath - The absolute path to the font file.
 * @returns {object|null} A structured metadata object or null on failure.
 */
function getFontMetadata(fontPath) {
    try {
        const font = opentype.loadSync(fontPath);
        const names = font.names;

        // Helper to safely get properties from the font's 'names' table.
        const getProp = (propName) => names[propName]?.en || NOT_AVAILABLE;

        return {
            title: getProp('fontFamily'),
            author: getProp('designer'),
            company: getProp('manufacturer'),
            copyright: getProp('copyright'),
            version: getProp('version'),
            description: getProp('description'),
            type: font.outlinesFormat, // 'truetype' or 'cff'
        };
    } catch (error) {
        logger.error(`Could not parse font metadata for ${path.basename(fontPath)}: ${error.message}`);
        return null;
    }
}

/**
 * Creates a formatted and length-safe caption string for a font document in Telegram.
 * @param {string} filename - The name of the font file.
 * @param {object} metadata - The metadata object from getFontMetadata().
 * @returns {string} A Telegram-ready caption string formatted with Markdown.
 */
function formatMetadataCaption(filename, metadata) {
    if (!metadata) {
        return `📄 *${filename}*`;
    }

    const fontType = metadata.type === 'truetype' ? 'TrueType (.ttf)' : 'OpenType (.otf)';

    // Build the caption line by line using an array for better readability.
    const captionLines = [
        `📄 *${filename}*`,
        ``, // Add a blank line for spacing
        `*» ឈ្មោះពុម្ពអក្សរ:* \`${truncate(metadata.title, TRUNCATE_LIMITS.DEFAULT)}\``,
        `*» ប្រភេទ:* \`${fontType}\``,
        `*» កំណែ:* \`${truncate(metadata.version, TRUNCATE_LIMITS.DEFAULT)}\``,
        `*» អ្នករចនា:* \`${truncate(metadata.author, TRUNCATE_LIMITS.DEFAULT)}\``,
        `*» ក្រុមហ៊ុន:* \`${truncate(metadata.company, TRUNCATE_LIMITS.DEFAULT)}\``,
        ``,
        `*» Copyright:*`,
        `\`${truncate(metadata.copyright, TRUNCATE_LIMITS.COPYRIGHT)}\``
    ];

    const fullCaption = captionLines.join('\n');

    // Final safeguard: ensure the entire generated caption respects Telegram's limit.
    return truncate(fullCaption, MAX_CAPTION_LENGTH);
}

module.exports = { getFontMetadata, formatMetadataCaption };