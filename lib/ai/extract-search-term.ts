/**
 * Extract search term from prompt - IMPROVED
 */
function extractSearchTerm(prompt: string): string {


    const lower = prompt.toLowerCase();

    // Remove filler words/phrases at the beginning
    let cleaned = lower
        .replace(/^(hey|hi|hello),?\s*/gi, '')
        .replace(/^(please|um|uh)\s+/gi, '')
        .replace(/^(get me|give me|show me|find me|search for|look for)\s+/gi, '')
        .replace(/^(can you|could you|would you)\s+(get|give|show|find|search|look)\s+(me\s+)?/gi, '')
        .trim();

    // Remove quantity patterns: "10 pics of" → ""
    cleaned = cleaned.replace(/^\d+\s+(pics?|images?|photos?|pictures?)\s+(of\s+)?/gi, '');

    // Remove "of" at the start
    cleaned = cleaned.replace(/^of\s+/gi, '');

    // Remove articles
    cleaned = cleaned.replace(/\b(a|an|the)\b\s+/gi, ' ');

    // Remove trailing generic words
    cleaned = cleaned
        .replace(/\s+(pics?|images?|photos?|pictures?)$/gi, '')
        .trim()
        .replace(/\s+/g, ' '); // Normalize spaces



    // If we have something meaningful, return it
    if (cleaned && cleaned.length > 2) {
        return cleaned;
    }

    // Fallback: extract any meaningful noun words
    const words = prompt.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w =>
            w.length > 2 &&
            !['hey', 'get', 'give', 'show', 'find', 'search', 'pics', 'images', 'photos', 'pictures', 'please', 'the'].includes(w)
        );

    const result = words.join(' ') || 'images';

    return result;
}
