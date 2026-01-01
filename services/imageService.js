// services/imageService.js

const fs = require('fs');
const { createCanvas, registerFont } = require('canvas');
const path = require('path');
const strings = require('../localization');
const { logger } = require('./logger');

// --- Fallback Font Registration ---
// We register a reliable Khmer font at startup to ensure Khmer text always renders.
let fallbackFontFamily = 'sans-serif'; // Use a generic system font as a last resort.
const fallbackFontPath = path.join(__dirname, '..', 'assets', 'KhmerOSSiemreap-Regular.ttf');

try {
    registerFont(fallbackFontPath, { family: 'KhmerOSFallback' });
    fallbackFontFamily = 'KhmerOSFallback'; // Only assign the custom name if registration succeeds.
    logger.info('Khmer fallback font registered successfully.');
} catch (error) {
    logger.warn(`Could not register Khmer fallback font. Previews may not show Khmer text correctly. Error: ${error.message}`);
    // Ensure fallback is always valid
    fallbackFontFamily = 'sans-serif';
}

/**
 * Safely constructs a font stack for Pango that prevents NULL descriptor errors.
 * @param {string|null} targetFont - The primary font family name to use
 * @param {string} fallbackFont - The fallback font family name
 * @returns {string} A valid font stack string
 */
function buildSafeFontStack(targetFont, fallbackFont) {
    const safeFallback = (fallbackFont && typeof fallbackFont === 'string' && fallbackFont.trim()) 
        ? fallbackFont.trim() : 'sans-serif';
    
    const fontStack = [];
    
    // Only add target font if it's a valid string
    if (targetFont && typeof targetFont === 'string' && targetFont.trim()) {
        fontStack.push(`"${targetFont.trim()}"`);
    }
    
    // Always add fallback font (safely quoted)
    fontStack.push(`"${safeFallback}"`);
    
    // Always add generic fallback
    fontStack.push('sans-serif');
    
    return fontStack.join(', ');
}

/**
 * Creates a standard error image when a font fails to load.
 * @param {string} errorMessage - The message to display on the image.
 * @returns {Buffer} A PNG image buffer.
 */
function createErrorImage(errorMessage) {
    const canvas = createCanvas(700, 220);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f8d7da'; // Light red background
    ctx.fillRect(0, 0, 700, 220);
    ctx.fillStyle = '#721c24'; // Dark red text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Use safe font stack for error messages too
    const safeErrorFont = buildSafeFontStack(null, fallbackFontFamily);
    ctx.font = `bold 24px ${safeErrorFont}`;
    
    const lines = errorMessage.split('\n');
    ctx.fillText(lines[0], 350, 90);
    if (lines[1]) {
        ctx.font = `20px ${buildSafeFontStack(null, 'monospace')}`;
        ctx.fillText(lines[1], 350, 125);
    }
    
    return canvas.toBuffer('image/png');
}

/**
 * Generates a high-quality PNG buffer showing a preview of a given font.
 * It's robust against font registration failures and uses a fallback for unsupported characters.
 * 
 * @param {string} fontPath - Absolute path to the .ttf or .otf file.
 * @param {string} fontName - The name of the font to display.
 * @returns {Buffer} A PNG image buffer.
 */
function generateFontPreview(fontPath, fontName) {
    // Validate inputs
    if (!fontPath || !fontName || typeof fontPath !== 'string' || typeof fontName !== 'string') {
        logger.error('Invalid parameters for generateFontPreview', { fontPath, fontName });
        return createErrorImage('Invalid font parameters');
    }
    
    // Check if font file exists and is readable
    if (!fs.existsSync(fontPath)) {
        logger.error(`Font file not found: ${fontPath}`);
        return createErrorImage(`Font file not found\n${fontName}`);
    }
    
    let targetFontFamily;
    let fileSize = 0;
    
    try {
        const stats = fs.statSync(fontPath);
        fileSize = stats.size;
        
        // Skip very large font files to prevent memory issues (> 10MB)
        if (fileSize > 10 * 1024 * 1024) {
            logger.warn(`Font file too large (${fileSize} bytes), skipping: ${fontName}`);
            return createErrorImage(`Font file too large\n${fontName}`);
        }
        
        // Skip empty files
        if (fileSize === 0) {
            logger.warn(`Empty font file: ${fontName}`);
            return createErrorImage(`Empty font file\n${fontName}`);
        }
    } catch (error) {
        logger.error(`Cannot access font file: ${fontPath}`, { error: error.message });
        return createErrorImage(`Cannot access font\n${fontName}`);
    }

    // Attempt to register the target font.
    try {
        // Create a unique family name to avoid conflicts
        const uniqueFamilyName = `FontPreview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        registerFont(fontPath, { family: uniqueFamilyName });
        targetFontFamily = uniqueFamilyName;
        
        logger.debug(`Successfully registered font: ${fontName}`, { familyName: uniqueFamilyName, fileSize });
    } catch (error) {
        logger.warn(`Could not register font: ${fontName}. Using fallback only.`, { 
            error: error.message, 
            fontPath,
            fileSize 
        });
        
        // Return error image for critical font registration failures
        if (error.message.includes('FreeType') || error.message.includes('invalid') || error.message.includes('corrupt')) {
            return createErrorImage(`Corrupted font file\n${fontName}`);
        }
        
        // For other errors, continue with fallback rendering
        targetFontFamily = null;
    }

    const canvasWidth = 700;
    const canvasHeight = 220;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // 1. Draw a clean background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.strokeStyle = '#E9ECEF';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvasWidth, canvasHeight);

    // 2. Safely construct the font stack for Pango to prevent NULL descriptor errors.
    const fontStack = buildSafeFontStack(targetFontFamily, fallbackFontFamily);

    // 3. Draw the font's own name at the top
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#212529';
    ctx.font = `bold 26px ${fontStack}`;
    ctx.fillText(fontName, 25, 20);

    // 4. Draw a separator line
    ctx.strokeStyle = '#DEE2E6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(25, 65);
    ctx.lineTo(canvasWidth - 25, 65);
    ctx.stroke();

    // 5. Draw the Khmer sample text (larger)
    ctx.font = `42px ${fontStack}`;
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';
    ctx.fillText(strings.previewTextKhmer, 25, 115);

    // 6. Draw the Latin sample text (smaller)
    ctx.font = `32px ${fontStack}`;
    ctx.fillStyle = '#495057';
    ctx.fillText(strings.previewTextLatin, 25, 175);

    // 7. Draw a subtle watermark
    ctx.font = `14px ${buildSafeFontStack(null, 'sans-serif')}`;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(strings.previewWatermark, canvasWidth - 20, canvasHeight - 15);

    return canvas.toBuffer('image/png');
}

module.exports = { 
    generateFontPreview,
    // We export createErrorImage in case it's needed elsewhere, though it's mainly internal.
    createErrorImage 
};