# my-WebApp

🏥 **AI Health Assessment System**

An intelligent computer systems application to assess human health using advanced algorithms and machine learning principles.

## Features

- **AI-Powered Health Assessment**: Uses intelligent algorithms to evaluate multiple health metrics
- **Comprehensive Health Analysis**: Analyzes age, BMI, blood pressure, heart rate, exercise, sleep, and stress levels
- **Personalized Recommendations**: Provides AI-generated health recommendations based on assessment results
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

The application uses a sophisticated AI algorithm that:

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
- **AI Algorithm**: Custom health assessment algorithm with weighted scoring

## Disclaimer

⚠️ **Important**: This is an AI-based assessment tool for informational and educational purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult with qualified healthcare professionals for medical decisions.

## License

ISC

## Author

Eguono22
