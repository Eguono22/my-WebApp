// Enhanced Health Assessment App with AI Chat Integration

let currentAssessmentData = null;

// Health Form Submission
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
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing Your Health...';
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
        currentAssessmentData = { ...formData, ...result };
        
        // Display results
        displayResults(result);
        
        // Hide form and show results with animation
        document.querySelector('.form-section').style.display = 'none';
        document.getElementById('resultsSection').style.display = 'block';
        
        // Scroll to results
        setTimeout(() => {
            document.getElementById('resultsSection').scrollIntoView({ 
                behavior: 'smooth',
                block: 'start'
            });
        }, 100);

    } catch (error) {
        showNotification('An error occurred during health assessment. Please try again.', 'error');
        console.error('Error:', error);
    } finally {
        // Reset button state
        const submitBtn = document.querySelector('.btn-submit');
        submitBtn.innerHTML = '<i class="fas fa-chart-line"></i> Analyze My Health';
        submitBtn.disabled = false;
    }
});

function displayResults(result) {
    // Display overall score with animation
    const scoreDisplay = document.getElementById('overallScore');
    const scoreStatus = document.getElementById('healthStatus');
    const scoreProgressBar = document.getElementById('scoreProgressBar');
    
    // Animate score counting
    animateValue(scoreDisplay, 0, result.overallScore, 1500);
    scoreStatus.textContent = result.status;
    
    // Set progress bar
    setTimeout(() => {
        scoreProgressBar.style.width = result.overallScore + '%';
    }, 100);
    
    // Set color based on score
    let statusColor;
    if (result.overallScore >= 85) {
        statusColor = '#10b981'; // Green
    } else if (result.overallScore >= 70) {
        statusColor = '#3b82f6'; // Blue
    } else if (result.overallScore >= 50) {
        statusColor = '#f59e0b'; // Yellow
    } else {
        statusColor = '#ef4444'; // Red
    }
    
    scoreDisplay.style.color = statusColor;

    // Display BMI
    const bmiValue = document.getElementById('bmiValue');
    const bmiCategory = document.getElementById('bmiCategory');
    bmiValue.textContent = result.bmi;
    
    // Set BMI category
    let category;
    if (result.bmi < 18.5) {
        category = 'Underweight';
    } else if (result.bmi < 25) {
        category = 'Normal Weight';
    } else if (result.bmi < 30) {
        category = 'Overweight';
    } else {
        category = 'Obese';
    }
    bmiCategory.textContent = category;

    // Display detailed scores
    const detailedScoresContainer = document.getElementById('detailedScores');
    detailedScoresContainer.innerHTML = '';
    
    // Metric name mapping and icons
    const metricLabels = {
        age: { name: 'Age Factor', icon: 'fa-calendar' },
        bmi: { name: 'Body Mass Index', icon: 'fa-weight-scale' },
        bloodPressure: { name: 'Blood Pressure', icon: 'fa-tachometer-alt' },
        heartRate: { name: 'Heart Rate', icon: 'fa-heartbeat' },
        exercise: { name: 'Exercise Level', icon: 'fa-running' },
        sleep: { name: 'Sleep Quality', icon: 'fa-bed' },
        stress: { name: 'Stress Management', icon: 'fa-brain' }
    };
    
    for (const [metric, score] of Object.entries(result.detailedScores)) {
        const scoreItem = document.createElement('div');
        scoreItem.className = 'score-item';
        
        const metricInfo = metricLabels[metric] || { name: metric, icon: 'fa-check' };
        
        scoreItem.innerHTML = `
            <span class="score-item-name">
                <i class="fas ${metricInfo.icon}"></i>
                ${metricInfo.name}
            </span>
            <div class="score-bar-container">
                <div class="score-bar" style="width: 0%;" data-width="${score}"></div>
            </div>
            <span class="score-item-value">${Math.round(score)}</span>
        `;
        
        detailedScoresContainer.appendChild(scoreItem);
        
        // Animate score bars
        setTimeout(() => {
            const bar = scoreItem.querySelector('.score-bar');
            bar.style.width = bar.dataset.width + '%';
        }, 100);
    }

    // Display recommendations
    const recommendationsList = document.getElementById('recommendationsList');
    recommendationsList.innerHTML = '';
    
    result.recommendations.forEach((recommendation, index) => {
        const li = document.createElement('li');
        li.textContent = recommendation;
        li.style.opacity = '0';
        li.style.transform = 'translateY(10px)';
        recommendationsList.appendChild(li);
        
        // Animate recommendations
        setTimeout(() => {
            li.style.transition = 'all 0.3s ease';
            li.style.opacity = '1';
            li.style.transform = 'translateY(0)';
        }, 100 * (index + 1));
    });
}

function animateValue(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        element.textContent = Math.round(current);
    }, 16);
}

function resetForm() {
    // Reset the form
    document.getElementById('healthForm').reset();
    currentAssessmentData = null;
    
    // Show form and hide results
    document.querySelector('.form-section').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'none';
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// AI Chat Functionality
const aiChatBtn = document.getElementById('aiChatBtn');
const aiChatPanel = document.getElementById('aiChatPanel');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const chatMessages = document.getElementById('chatMessages');
const askAiBtn = document.getElementById('askAiBtn');

// Toggle chat panel
aiChatBtn.addEventListener('click', () => {
    aiChatPanel.classList.add('active');
    aiChatBtn.style.display = 'none';
    chatInput.focus();
});

closeChatBtn.addEventListener('click', () => {
    aiChatPanel.classList.remove('active');
    aiChatBtn.style.display = 'flex';
});

// Open chat from results page
if (askAiBtn) {
    askAiBtn.addEventListener('click', () => {
        aiChatPanel.classList.add('active');
        aiChatBtn.style.display = 'none';
        chatInput.focus();
        
        // Send initial context message
        if (currentAssessmentData) {
            const contextMessage = `I just completed a health assessment. My overall score is ${currentAssessmentData.overallScore} (${currentAssessmentData.status}). Can you help me understand my results better?`;
            setTimeout(() => {
                chatInput.value = contextMessage;
            }, 300);
        }
    });
}

// Send message
sendChatBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    
    // Add user message to chat
    addMessage(message, 'user');
    chatInput.value = '';
    
    // Show typing indicator
    const typingIndicator = addTypingIndicator();
    
    try {
        // Call AI chat API
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                context: currentAssessmentData
            })
        });
        
        if (!response.ok) {
            throw new Error('Chat request failed');
        }
        
        const data = await response.json();
        
        // Remove typing indicator
        typingIndicator.remove();
        
        // Add bot response
        addMessage(data.response, 'bot');
        
    } catch (error) {
        console.error('Chat error:', error);
        typingIndicator.remove();
        addMessage('I apologize, but I\'m having trouble connecting right now. Please try again in a moment.', 'bot');
    }
}

function addMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.innerHTML = `
        <div class="message-content">
            <p>${text}</p>
            <span class="message-time">${timeString}</span>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return messageDiv;
}

function addTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'message bot-message';
    indicator.innerHTML = `
        <div class="message-content">
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    
    chatMessages.appendChild(indicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return indicator;
}

// Share Results
const shareResultsBtn = document.getElementById('shareResultsBtn');
if (shareResultsBtn) {
    shareResultsBtn.addEventListener('click', async () => {
        if (!currentAssessmentData) return;
        
        const shareText = `My Health Assessment Results:
Overall Score: ${currentAssessmentData.overallScore}/100 (${currentAssessmentData.status})
BMI: ${currentAssessmentData.bmi}

Check your health at: ${window.location.href}`;
        
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'My Health Assessment',
                    text: shareText
                });
                showNotification('Results shared successfully!', 'success');
            } catch (error) {
                if (error.name !== 'AbortError') {
                    fallbackShare(shareText);
                }
            }
        } else {
            fallbackShare(shareText);
        }
    });
}

function fallbackShare(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Results copied to clipboard!', 'success');
    }).catch(() => {
        showNotification('Unable to share results', 'error');
    });
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        font-weight: 500;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animation styles dynamically
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateX(100px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }
    
    @keyframes slideOut {
        from {
            opacity: 1;
            transform: translateX(0);
        }
        to {
            opacity: 0;
            transform: translateX(100px);
        }
    }
`;
document.head.appendChild(style);

// Welcome message on page load
window.addEventListener('load', () => {
    setTimeout(() => {
        showNotification('Welcome! Start your health assessment or chat with our AI assistant.', 'info');
    }, 1000);
});
