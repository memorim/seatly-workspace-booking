import { createApp } from './app.js';
const port = Number(process.env.PORT || 4200);
createApp().listen(port, () => console.log(`Seatly API: http://localhost:${port}`));

