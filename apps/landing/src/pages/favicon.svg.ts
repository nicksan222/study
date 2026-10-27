// The browser tab's icon: the small mark, as in the app's title bar.
import { small } from '../brand';

export const GET = () => new Response(small, { headers: { 'Content-Type': 'image/svg+xml' } });
