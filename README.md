# Prism AI 🎨✨

**Chat-First Automation Platform for Graphic Designers**

Prism AI transforms natural language commands into powerful automation workflows. Simply describe what you want to do, and Prism will create and execute a node-based workflow behind the scenes.

## 🚀 Features

- **Natural Language Interface**: Chat with AI to create workflows
- **Visual Workflow Builder**: See your workflows as connected nodes (React Flow)
- **Smart Execution**: Automatic topological sort and execution
- **Image Processing**: Scrape, filter, sort, and manipulate images
- **AI Integration**: Powered by Google Gemini 1.5 Flash
- **Persistent Storage**: Save workflows and execution history in Supabase

## 📋 Prerequisites

Before running this project, you need:

1. **Node.js** (v18 or later)
2. **Supabase Account** - [Create free account](https://supabase.com)
3. **Google AI API Key** - [Get API key](https://makersuite.google.com/app/apikey)

## 🛠️ Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase Database

1. Create a new project in [Supabase](https://supabase.com)
2. Go to the SQL Editor in your Supabase dashboard
3. Copy the contents of `supabase/schema.sql`
4. Paste and run in the SQL Editor

### 3. Configure Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.local.example .env.local
   ```

2. Edit `.env.local` and fill in your credentials:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   GEMINI_API_KEY=your-gemini-api-key
   ```

   - Find Supabase credentials in: Project Settings → API
   - Get Gemini API key from: [Google AI Studio](https://makersuite.google.com/app/apikey)

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🎯 How to Use

1. **Enter a natural language command** in the chat:
   - "Find 10 pink flowers and remove backgrounds"
   - "Get 5 landscape photos and sort by resolution"
   - "Generate a sunset image"

2. **Click "Under the Hood"** to see the workflow visualization

3. **View results** directly in the chat (gallery, table, or text)

## 🏗️ Architecture

### Tech Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS
- **Workflow Visualization**: React Flow
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL)
- **AI**: Google Gemini 1.5 Flash
- **Image Processing**: Sharp (placeholder for MVP)

### Project Structure

```
prism-ai/
├── app/
│   ├── api/workflow/          # API routes
│   ├── globals.css            # Global styles
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Main page
├── components/
│   ├── canvas/                # React Flow components
│   ├── chat/                  # Chat interface
│   └── layout/                # Layout components
├── lib/
│   ├── ai/                    # Gemini integration
│   ├── db/                    # Supabase operations
│   ├── nodes/                 # Node registry & types
│   ├── workflow-engine.ts     # Execution engine
│   └── utils.ts               # Utilities
└── supabase/
    └── schema.sql             # Database schema
```

### Node Types

1. **Scrape Images**: Search and fetch images (mock data in MVP)
2. **Remove Background**: Process images to remove backgrounds
3. **Filter & Sort**: Sort images by resolution, size, or format
4. **AI Generate**: Generate images with AI prompts

## 🔧 Development

### Build for Production

```bash
npm run build
npm start
```

### Lint Code

```bash
npm run lint
```

## 🚧 MVP Limitations

This is an MVP focusing on architecture and core functionality:

- Image scraping uses **mock data** (placeholder for Puppeteer integration)
- Background removal is **simulated** (placeholder for remove.bg API)
- AI image generation uses **placeholder images** (ready for Gemini Imagen)
- No user authentication (all workflows saved as "anonymous")

## 🎨 Design Philosophy

Prism AI prioritizes:

- **Premium Aesthetics**: Glassmorphism, gradients, smooth animations
- **Chat-First UX**: Conversation is the primary interface
- **Progressive Disclosure**: Advanced features (canvas view) are hidden by default
- **Visual Feedback**: Loading states, animations, and real-time updates

## 📝 Example Prompts

Try these commands:

- "Find 20 sunset photos and sort by resolution"
- "Get 10 product images and remove backgrounds"
- "Search for 15 nature images, remove backgrounds, and sort descending"
- "Generate an image of a vibrant cityscape at night"

## 🤝 Contributing

This is an MVP for demonstration. Future enhancements:

- Real image scraping with Puppeteer
- Actual background removal via APIs
- User authentication and multi-tenancy
- Export workflows as JSON/code
- Custom node creation
- Workflow templates

## 📄 License

MIT License - feel free to use this for your own projects!

## 🙏 Acknowledgments

Built with:
- [Next.js](https://nextjs.org/)
- [React Flow](https://reactflow.dev/)
- [Supabase](https://supabase.com/)
- [Google Gemini](https://deepmind.google/technologies/gemini/)
- [Tailwind CSS](https://tailwindcss.com/)

---

**Made with ✨ by Prism AI** - Transforming natural language into automation workflows
