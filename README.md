# my-WebApp

🏥 **Health Assessment System**

A web application that helps people review health metrics using a weighted scoring model, progress history, and guided wellness recommendations.

## Features

- **Weighted Health Assessment**: Uses a rules-based scoring system to evaluate multiple health metrics
- **Comprehensive Health Analysis**: Analyzes age, BMI, blood pressure, heart rate, exercise, sleep, and stress levels
- **Personalized Recommendations**: Provides practical recommendations based on assessment results
- **User-Friendly Interface**: Clean, modern web interface for easy data input and result visualization
- **Real-Time Scoring**: Instant health score calculation with detailed breakdowns

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Eguono22/my-WebApp.git
cd my-WebApp
```

2. Install dependencies:
```bash
npm install
```

## Usage

1. Start the server:
```bash
npm start
```

2. Open your web browser and navigate to:
```
http://localhost:3000
```

3. Enter your health information in the form:
   - Age
   - Weight and Height (for BMI calculation)
   - Blood Pressure (Systolic and Diastolic)
   - Resting Heart Rate
   - Exercise hours per week
   - Sleep hours per night
   - Stress level

4. Click "Assess My Health" to receive your comprehensive health assessment

## Health Metrics Evaluated

The system evaluates the following health metrics with weighted importance:

- **Age** (15%): Age-based health risk assessment
- **BMI** (25%): Body Mass Index calculation and evaluation
- **Blood Pressure** (20%): Systolic and diastolic pressure analysis
- **Heart Rate** (15%): Resting heart rate evaluation
- **Exercise** (10%): Physical activity level assessment
- **Sleep** (10%): Sleep duration analysis
- **Stress** (5%): Stress level impact on overall health

## How It Works

The application uses a weighted scoring algorithm that:

1. **Collects Data**: Gathers comprehensive health metrics from the user
2. **Calculates Scores**: Each metric is scored individually using evidence-based health guidelines
3. **Weighted Analysis**: Applies weighted scoring to calculate an overall health score
4. **Generates Insights**: Produces personalized recommendations based on the assessment
5. **Visualizes Results**: Displays results with intuitive charts and clear explanations

## Health Score Categories

- **85-100**: Excellent Health
- **70-84**: Good Health
- **50-69**: Fair Health
- **Below 50**: Needs Improvement

## Technology Stack

- **Backend**: Node.js with Express
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Assessment Engine**: Custom health assessment algorithm with weighted scoring

## Disclaimer

⚠️ **Important**: This assessment tool is for informational and educational purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult qualified healthcare professionals for medical decisions.

## Data Handling

- Assessment history is stored in the browser for progress tracking.
- If a user chooses to use the sync feature, history and goal data are stored server-side and linked to a Profile ID.
- The app supports `DATABASE_URL` for managed Postgres storage in production and falls back to local SQLite when `DATABASE_URL` is not set.
- For Vercel production, connect a managed Postgres database so sync and analytics data remain durable across deployments and instances.

## Analytics

- The app records lightweight product events such as page views, completed assessments, chat opens, shared results, and sync actions.
- Analytics events are stored locally in the same SQLite database so you can measure usage before integrating a third-party analytics platform.
- Set `ANALYTICS_ADMIN_PASSWORD` before starting the server to protect `/analytics.html` and `/api/analytics/summary`.
- Open `/analytics.html` locally and sign in with username `admin` plus the password from `ANALYTICS_ADMIN_PASSWORD` to view the built-in analytics dashboard.
- The dashboard now includes onboarding funnel signals such as form starts, example-data usage, draft restores, and start-to-complete conversion.

## License

ISC

## Author

Eguono22
