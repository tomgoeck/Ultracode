/**
 * Project Templates - Pre-configured project setups
 */

const TEMPLATES = {
  "react-tailwind": {
    id: "react-tailwind",
    name: "React + TailwindCSS",
    description: "Modern React app with TailwindCSS styling",
    icon: "⚛️",
    projectMd: `# React + TailwindCSS Project

## Overview
A modern web application built with React and TailwindCSS.

## Tech Stack
- **Framework:** React 18
- **Styling:** TailwindCSS
- **Build Tool:** react-scripts (Create React App)
- **Testing:** None (can be added later)

## Project Structure
\`\`\`
src/
├── components/    # Reusable React components
├── pages/         # Page components
├── utils/         # Helper functions
└── App.jsx        # Main app component
\`\`\`

## Development Rules
- Use functional components with hooks
- Follow TailwindCSS utility-first approach
- Keep components small and focused
- Use semantic HTML elements
`,
    features: [
      {
        id: "F001",
        name: "Foundation: Project scaffold & base layout",
        description: "Set up React project with TailwindCSS, create folder structure, add basic App shell with navigation",
        priority: "A",
        depends_on: [],
        definition_of_done: [
          { type: "automated", description: "package.json exists with React and TailwindCSS dependencies" },
          { type: "automated", description: "public/index.html exists with root div" },
          { type: "automated", description: "src/index.js exists and renders App" },
          { type: "automated", description: "tailwind.config.js configured" },
        ]
      }
    ]
  },

  "react-portfolio": {
    id: "react-portfolio",
    name: "Portfolio Website",
    description: "Complete portfolio site with React & TailwindCSS",
    icon: "💼",
    projectMd: `# Portfolio Website

## Overview
A modern portfolio website to showcase projects and skills.

## Tech Stack
- **Framework:** React 18
- **Styling:** TailwindCSS
- **Deployment:** Vercel
- **Contact Form:** EmailJS

## Features
- Hero section with introduction
- About section with bio
- Projects showcase
- Contact form

## UI / Design Guidelines
- **Primary Color:** Blue (#3B82F6)
- **Secondary Color:** Gray (#6B7280)
- **Font:** Inter, sans-serif
- **Layout:** Responsive, mobile-first
`,
    features: [
      {
        id: "F001",
        name: "Foundation: Project setup",
        description: "Initialize React + TailwindCSS project with all config files",
        priority: "A",
        depends_on: [],
        definition_of_done: [
          { type: "automated", description: "Project builds successfully" },
          { type: "automated", description: "TailwindCSS is working" },
        ]
      },
      {
        id: "F002",
        name: "Hero Section",
        description: "Create hero section with name, tagline, and CTA button",
        priority: "A",
        depends_on: ["F001"],
        definition_of_done: [
          { type: "manual", description: "Hero displays correctly on desktop and mobile" },
        ]
      },
      {
        id: "F003",
        name: "About Section",
        description: "Create about section with bio and skills",
        priority: "A",
        depends_on: ["F001"],
        definition_of_done: [
          { type: "manual", description: "About section is readable and well-styled" },
        ]
      },
      {
        id: "F004",
        name: "Projects Showcase",
        description: "Create projects grid with 3 example projects (title, description, image placeholders)",
        priority: "A",
        depends_on: ["F001"],
        definition_of_done: [
          { type: "manual", description: "Projects display in responsive grid" },
        ]
      },
      {
        id: "F005",
        name: "Contact Form with EmailJS",
        description: "Create contact form (name, email, message) with EmailJS integration",
        priority: "B",
        depends_on: ["F001"],
        definition_of_done: [
          { type: "manual", description: "Form has validation" },
          { type: "manual", description: "Form submits to EmailJS" },
        ]
      }
    ]
  },

  "nextjs-blog": {
    id: "nextjs-blog",
    name: "Next.js Blog",
    description: "SEO-friendly blog with Next.js and Markdown",
    icon: "📝",
    projectMd: `# Next.js Blog

## Overview
A fast, SEO-friendly blog built with Next.js 14 and markdown content.

## Tech Stack
- **Framework:** Next.js 14 (App Router)
- **Styling:** TailwindCSS
- **Content:** Markdown files
- **Syntax Highlighting:** Prism.js
- **Deployment:** Vercel

## Features
- Static site generation for fast performance
- Markdown-based content management
- Syntax highlighting for code blocks
- SEO optimized

## Project Structure
\`\`\`
app/
├── page.js           # Homepage
├── blog/
│   └── [slug]/       # Blog post pages
├── components/       # Reusable components
posts/                # Markdown blog posts
\`\`\`
`,
    features: [
      {
        id: "F001",
        name: "Foundation: Next.js setup",
        description: "Initialize Next.js 14 project with App Router and TailwindCSS",
        priority: "A",
        depends_on: [],
        definition_of_done: [
          { type: "automated", description: "Next.js dev server starts" },
          { type: "automated", description: "TailwindCSS is configured" },
        ]
      },
      {
        id: "F002",
        name: "Markdown Blog Post System",
        description: "Create markdown parser, file reader, and blog post component",
        priority: "A",
        depends_on: ["F001"],
        definition_of_done: [
          { type: "automated", description: "Can read .md files from posts/ folder" },
          { type: "manual", description: "Blog post renders with styling" },
        ]
      },
      {
        id: "F003",
        name: "Blog Post Listing Page",
        description: "Create homepage that lists all blog posts with title, excerpt, date",
        priority: "A",
        depends_on: ["F002"],
        definition_of_done: [
          { type: "manual", description: "All posts are listed" },
          { type: "manual", description: "Can click to view full post" },
        ]
      }
    ]
  },

  "express-api": {
    id: "express-api",
    name: "Express REST API",
    description: "Node.js REST API with Express and MongoDB",
    icon: "🚀",
    projectMd: `# Express REST API

## Overview
A RESTful API built with Express.js and MongoDB.

## Tech Stack
- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB (Mongoose)
- **Auth:** JWT
- **Validation:** Joi

## API Structure
\`\`\`
routes/
├── auth.js        # Authentication routes
├── users.js       # User CRUD
models/
├── User.js        # User schema
middleware/
├── auth.js        # JWT verification
\`\`\`

## Development Rules
- All routes return JSON
- Use async/await for DB operations
- Validate all input with Joi
- Return proper HTTP status codes
`,
    features: [
      {
        id: "F001",
        name: "Foundation: Express + MongoDB setup",
        description: "Initialize Express server, connect to MongoDB, set up basic middleware",
        priority: "A",
        depends_on: [],
        definition_of_done: [
          { type: "automated", description: "Server starts on port 3000" },
          { type: "automated", description: "MongoDB connection successful" },
        ]
      },
      {
        id: "F002",
        name: "User Model & Validation",
        description: "Create User Mongoose schema with validation",
        priority: "A",
        depends_on: ["F001"],
        definition_of_done: [
          { type: "automated", description: "User model exports successfully" },
        ]
      },
      {
        id: "F003",
        name: "User CRUD Routes",
        description: "Create POST /users, GET /users, GET /users/:id, PUT /users/:id, DELETE /users/:id",
        priority: "A",
        depends_on: ["F002"],
        definition_of_done: [
          { type: "manual", description: "All CRUD operations work via Postman" },
        ]
      }
    ]
  }
};

/**
 * Get all available templates
 * @returns {Array<Object>}
 */
function getAllTemplates() {
  return Object.values(TEMPLATES);
}

/**
 * Get a specific template by ID
 * @param {string} templateId
 * @returns {Object|null}
 */
function getTemplate(templateId) {
  return TEMPLATES[templateId] || null;
}

module.exports = {
  getAllTemplates,
  getTemplate,
  TEMPLATES,
};
