/**
 * JSON.stringify with sorted keys for stable comparison
 */
export function stableStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
        return '[' + obj.map(stableStringify).join(',') + ']';
    }

    const keys = Object.keys(obj).sort();
    return '{' + keys.map(key => JSON.stringify(key) + ':' + stableStringify(obj[key])).join(',') + '}';
}

/**
 * Strips volatile execution data from a workflow to ensure stable hashes across saves
 */
export function cleanWorkflowForSave(workflow: any): any {
    if (!workflow || !workflow.nodes) return workflow;
    return {
        ...workflow,
        nodes: workflow.nodes.map((n: any) => {
            // Critical Fix: DO NOT strip `output` or `outputMetadata`. 
            // The backend saves image URLs into outputMetadata. 
            // If stripped here, moving a node will delete all images from the database!
            const { status, ...cleanData } = (n.data || {});
            return { ...n, data: cleanData };
        })
    };
}
