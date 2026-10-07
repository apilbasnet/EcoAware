# EcoAware

EcoAware is a web-based waste-management platform that helps communities
report, verify, collect, and track waste. Users can upload waste reports,
review collection activity, earn rewards, and use the EcoBot assistant.

The application combines a local machine-learning model for waste-type
classification with cloud-based services for quantity estimation, location
search, authentication, and conversational assistance.

## Features

- **Waste reporting**: Upload a waste image, provide its location, and submit a
  report after verification.
- **On-device waste classification**: TensorFlow.js loads the model from
  `public/model` and classifies the uploaded image in the browser.
- **AI-assisted quantity estimation**: Google Gemini estimates the quantity of
  the identified waste. The result is normalized to a value such as `2.5 kg`.
- **Confidence validation**: Classification is accepted only when the top
  prediction has at least `0.60` confidence and a `0.20` margin over the
  second-best prediction.
- **Location suggestions**: Google Maps Places provides location search and
  suggestions.
- **Collection workflow**: Collectors can view and manage waste-collection
  tasks.
- **Rewards and leaderboard**: Users can earn points/tokens for participation
  and view rankings.
- **EcoBot**: A Gemini-powered conversational interface for waste-management
  assistance.
- **Web3 authentication**: Web3Auth handles user sign-in and session state.
- **Persistent data**: User, report, reward, collection, notification, and
  transaction data are stored in PostgreSQL through Neon and Drizzle ORM.

## Technology stack

- Next.js 14 and React 18
- TypeScript
- Tailwind CSS
- TensorFlow.js
- Google Gemini API
- Google Maps Places API
- Web3Auth
- PostgreSQL with Neon
- Drizzle ORM and Drizzle Kit
- React Leaflet
- Ethers, Viem, and related Web3 integrations

## How verification works

1. A logged-in user uploads an image.
2. The image is processed locally in the browser.
3. TensorFlow.js resizes the image to `224 x 224` pixels and normalizes its
   pixel values to `[-1, 1]`.
4. The local model predicts a waste category and produces scores for each
   category.
5. The result is rejected when confidence is below `0.60` or the prediction
   margin is below `0.20`.
6. For an accepted classification, Gemini estimates the quantity.
7. The quantity is parsed and normalized before the report can be submitted.

This is a hybrid workflow: TensorFlow.js performs waste-type classification,
while Gemini remains responsible for quantity estimation and other AI-supported
features. AI has not been completely removed from the application.

## Requirements

- Node.js 20 or later
- npm
- A PostgreSQL-compatible database, such as Neon
- Credentials for Web3Auth
- A Google Gemini API key
- A Google Maps API key with Places enabled

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/apilbasnet/EcoAware.git
cd EcoAware
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env.local` file in the project root:

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
NEXT_PUBLIC_WEB3_AUTH_CLIENT_ID=your_web3auth_client_id
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

Do not commit `.env.local` or expose private credentials in source control.
The `NEXT_PUBLIC_` prefix means the value is available to browser code, so
these keys must be restricted appropriately in their provider dashboards.

### 4. Create or update the database schema

```bash
npm run db:push
```

The Drizzle schema is defined in
`src/utils/db/schema.ts`, and the database connection is configured in
`src/utils/db/dbConfig.jsx`.

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Create a production build |
| `npm run start` | Start the production server |
| `npm run lint` | Run the project linter |
| `npm run db:push` | Push the Drizzle schema to the configured database |
| `npm run db:studio` | Open Drizzle Studio |

## Application routes

| Route | Purpose |
| --- | --- |
| `/` | Home page and impact summary |
| `/report` | Upload and submit waste reports |
| `/collect` | View and manage collection work |
| `/rewards` | View available rewards and earned points |
| `/leaderboard` | View community rankings |
| `/messages` | Use the EcoBot assistant |
| `/settings` | Manage user settings |
| `/verify` | Verification-related application view |

## Project structure

```text
src/
├── app/                  Next.js pages and route-level UI
├── components/           Reusable UI and Web3/map components
├── hooks/                Client-side hooks, including Web3Auth
└── utils/
    ├── db/               Drizzle schema and database actions
    ├── GeminiModels.ts   Gemini model fallback and quota handling
    ├── priority.ts       Quantity parsing and prioritization helpers
    └── wasteClassifier.ts TensorFlow.js image classification

public/
└── model/                TensorFlow.js model and weight shards
```

## Data model

The PostgreSQL schema includes:

- `users`
- `reports`
- `rewards`
- `collected_wastes`
- `notifications`
- `transactions`

Reports store the location, waste type, estimated amount, optional image URL,
verification result, status, and collector assignment.

## Production build

Run a production build locally before deployment:

```bash
npm run build
npm run start
```

Make sure all required environment variables are configured in the deployment
environment and that the database is reachable from the deployed application.

## Troubleshooting

### Missing Web3Auth client ID

Set `NEXT_PUBLIC_WEB3_AUTH_CLIENT_ID` in `.env.local` and restart the
development server.

### Database connection errors

Check `DATABASE_URL`, confirm that the database is running, and run:

```bash
npm run db:push
```

### Location suggestions do not appear

Confirm that `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is valid and that the Places API
is enabled for the associated Google Cloud project.

### Gemini requests fail

Confirm `NEXT_PUBLIC_GEMINI_API_KEY`, check the provider quota, and remember
that waste-type classification itself is performed locally by TensorFlow.js.

### Image verification fails

Use a clear, well-lit image with the waste visible. Images with low model
confidence or an ambiguous top-two prediction are intentionally rejected.

## Security and privacy

- Never commit API keys, database URLs, wallet secrets, or `.env.local`.
- Restrict public API keys by domain, API, and usage quota where supported.
- Validate authentication before allowing report verification or submission.
- Treat Gemini quantity output as an estimate, not a measured physical quantity.

## License

No license file is currently included in this repository. Add a license before
distributing the project outside its intended academic or development use.
