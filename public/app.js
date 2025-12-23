document.getElementById('healthForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get form data
    const formData = {
        age: parseInt(document.getElementById('age').value),
        weight: parseFloat(document.getElementById('weight').value),
        height: parseFloat(document.getElementById('height').value),
        systolic: parseInt(document.getElementById('systolic').value),
        diastolic: parseInt(document.getElementById('diastolic').value),
        heartRate: parseInt(document.getElementById('heartRate').value),
        exerciseHours: parseFloat(document.getElementById('exerciseHours').value),
        sleepHours: parseFloat(document.getElementById('sleepHours').value),
        stressLevel: parseInt(document.getElementById('stressLevel').value)
    };

    try {
        // Show loading state
        const submitBtn = document.querySelector('.btn-submit');
        submitBtn.textContent = '🔄 Analyzing...';
        submitBtn.disabled = true;

        // Call the API
        const response = await fetch('/api/assess', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            throw new Error('Assessment failed');
        }

        const result = await response.json();
        
        // Display results
        displayResults(result);
        
        // Hide form and show results
        document.querySelector('.form-section').style.display = 'none';
        document.getElementById('resultsSection').style.display = 'block';
        
        // Scroll to results
        document.getElementById('resultsSection').scrollIntoView({ 
            behavior: 'smooth' 
        });

    } catch (error) {
        alert('An error occurred during health assessment. Please try again.');
        console.error('Error:', error);
    } finally {
        // Reset button state
        const submitBtn = document.querySelector('.btn-submit');
        submitBtn.textContent = '🔍 Assess My Health';
        submitBtn.disabled = false;
    }
});

function displayResults(result) {
    // Display overall score
    document.getElementById('overallScore').textContent = result.overallScore;
    document.getElementById('healthStatus').textContent = result.status;
    
    // Set color based on score
    const scoreDisplay = document.getElementById('overallScore');
    if (result.overallScore >= 85) {
        scoreDisplay.style.color = '#28a745';
    } else if (result.overallScore >= 70) {
        scoreDisplay.style.color = '#17a2b8';
    } else if (result.overallScore >= 50) {
        scoreDisplay.style.color = '#ffc107';
    } else {
        scoreDisplay.style.color = '#dc3545';
    }

    // Display BMI
    document.getElementById('bmiValue').textContent = result.bmi;

    // Display detailed scores
    const detailedScoresContainer = document.getElementById('detailedScores');
    detailedScoresContainer.innerHTML = '';
    
    for (const [metric, score] of Object.entries(result.detailedScores)) {
        const scoreItem = document.createElement('div');
        scoreItem.className = 'score-item';
        
        const metricName = metric.replace(/([A-Z])/g, ' $1').trim();
        
        scoreItem.innerHTML = `
            <span class="score-item-name">${metricName}</span>
            <div class="score-bar-container">
                <div class="score-bar" style="width: ${score}%"></div>
            </div>
            <span class="score-item-value">${Math.round(score)}</span>
        `;
        
        detailedScoresContainer.appendChild(scoreItem);
    }

    // Display recommendations
    const recommendationsList = document.getElementById('recommendationsList');
    recommendationsList.innerHTML = '';
    
    result.recommendations.forEach(recommendation => {
        const li = document.createElement('li');
        li.textContent = recommendation;
        recommendationsList.appendChild(li);
    });
}

function resetForm() {
    // Reset the form
    document.getElementById('healthForm').reset();
    
    // Show form and hide results
    document.querySelector('.form-section').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'none';
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
