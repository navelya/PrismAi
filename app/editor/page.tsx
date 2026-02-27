import { redirect } from 'next/navigation';

/**
 * /editor is no longer a standalone page.
 * The workflow canvas is embedded in the workspace layout on the chat page.
 * Redirect to the most recent chat session (or new chat).
 */
export default function EditorPage() {
    redirect('/chat');
}
