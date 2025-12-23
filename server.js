const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Health Assessment AI Algorithm
class HealthAssessmentAI {
  constructor() {
    // Weight factors for different health metrics
    this.weights = {
      age: 0.15,
      bmi: 0.25,
      bloodPressure: 0.20,
      heartRate: 0.15,
      exercise: 0.10,
      sleep: 0.10,
      stress: 0.05
    };
  }

  calculateBMI(weight, height) {
    // weight in kg, height in cm
    const heightInMeters = height / 100;
    return weight / (heightInMeters * heightInMeters);
  }

  scoreBMI(bmi) {
    if (bmi < 18.5) return 60; // Underweight
    if (bmi >= 18.5 && bmi < 25) return 100; // Normal
    if (bmi >= 25 && bmi < 30) return 70; // Overweight
    if (bmi >= 30 && bmi < 35) return 50; // Obese
    return 30; // Severely obese
  }

  scoreAge(age) {
    if (age < 30) return 100;
    if (age < 50) return 90;
    if (age < 65) return 75;
    return 60;
  }

  scoreBloodPressure(systolic, diastolic) {
    if (systolic < 120 && diastolic < 80) return 100; // Normal
    if (systolic < 130 && diastolic < 85) return 85; // Elevated
    if (systolic < 140 && diastolic < 90) return 70; // Stage 1 hypertension
    if (systolic < 180 && diastolic < 120) return 40; // Stage 2 hypertension
    return 20; // Hypertensive crisis
  }

  scoreHeartRate(heartRate, age) {
    const maxHeartRate = 220 - age;
    const restingOptimal = 60;
    const restingMax = 100;
    
    if (heartRate >= restingOptimal && heartRate <= restingMax) return 100;
    if (heartRate < restingOptimal) return 90;
    if (heartRate > restingMax && heartRate <= maxHeartRate * 0.6) return 70;
    return 50;
  }

  scoreExercise(hoursPerWeek) {
    if (hoursPerWeek >= 5) return 100;
    if (hoursPerWeek >= 3) return 85;
    if (hoursPerWeek >= 1) return 60;
    return 30;
  }

  scoreSleep(hoursPerNight) {
    if (hoursPerNight >= 7 && hoursPerNight <= 9) return 100;
    if (hoursPerNight >= 6 || hoursPerNight <= 10) return 80;
    return 50;
  }

  scoreStress(stressLevel) {
    // stressLevel: 1 (low) to 5 (high)
    return 100 - (stressLevel - 1) * 20;
  }

  assessHealth(data) {
    const bmi = this.calculateBMI(data.weight, data.height);
    
    const scores = {
      age: this.scoreAge(data.age),
      bmi: this.scoreBMI(bmi),
      bloodPressure: this.scoreBloodPressure(data.systolic, data.diastolic),
      heartRate: this.scoreHeartRate(data.heartRate, data.age),
      exercise: this.scoreExercise(data.exerciseHours),
      sleep: this.scoreSleep(data.sleepHours),
      stress: this.scoreStress(data.stressLevel)
    };

    // Calculate weighted overall score
    let overallScore = 0;
    for (const [metric, score] of Object.entries(scores)) {
      overallScore += score * this.weights[metric];
    }

    // Generate health status and recommendations
    let status, recommendations;
    if (overallScore >= 85) {
      status = 'Excellent';
      recommendations = [
        'Your health metrics are excellent! Keep up the good work.',
        'Continue your current lifestyle and health habits.',
        'Schedule regular check-ups to maintain your health.'
      ];
    } else if (overallScore >= 70) {
      status = 'Good';
      recommendations = [
        'Your overall health is good, but there\'s room for improvement.',
        'Focus on areas with lower scores to optimize your health.',
        'Consider consulting a healthcare provider for personalized advice.'
      ];
    } else if (overallScore >= 50) {
      status = 'Fair';
      recommendations = [
        'Your health needs attention in several areas.',
        'Increase physical activity to at least 3 hours per week.',
        'Aim for 7-9 hours of sleep each night.',
        'Consider stress management techniques like meditation or yoga.',
        'Consult with a healthcare provider for a comprehensive health plan.'
      ];
    } else {
      status = 'Needs Improvement';
      recommendations = [
        'Your health requires immediate attention.',
        'Please consult with a healthcare provider as soon as possible.',
        'Start with small lifestyle changes: more exercise, better sleep, healthier diet.',
        'Monitor your blood pressure and heart rate regularly.',
        'Consider joining support groups or health programs.'
      ];
    }

    return {
      overallScore: Math.round(overallScore),
      status,
      bmi: Math.round(bmi * 10) / 10,
      detailedScores: scores,
      recommendations
    };
  }
}

const healthAI = new HealthAssessmentAI();

// API endpoint for health assessment
app.post('/api/assess', (req, res) => {
  try {
    const healthData = req.body;
    
    // Validate required fields
    const requiredFields = ['age', 'weight', 'height', 'systolic', 'diastolic', 
                           'heartRate', 'exerciseHours', 'sleepHours', 'stressLevel'];
    
    for (const field of requiredFields) {
      if (healthData[field] === undefined || healthData[field] === null) {
        return res.status(400).json({ 
          error: `Missing required field: ${field}` 
        });
      }
    }

    const assessment = healthAI.assessHealth(healthData);
    res.json(assessment);
  } catch (error) {
    console.error('Assessment error:', error);
    res.status(500).json({ 
      error: 'An error occurred during health assessment' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Health Assessment Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to access the application`);
});
