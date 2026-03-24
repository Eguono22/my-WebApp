// Enhanced Health Assessment App with AI Chat Integration

let currentAssessmentData = null;
const HISTORY_STORAGE_KEY = 'healthAssessmentHistoryV1';
const SCORE_GOAL_STORAGE_KEY = 'healthAssessmentScoreGoalV1';
const SYNC_PROFILE_STORAGE_KEY = 'healthAssessmentSyncProfileV1';
const AUTH_TOKEN_STORAGE_KEY = 'healthAssessmentAuthTokenV1';
const AUTH_USER_STORAGE_KEY = 'healthAssessmentAuthUserV1';
let trendChart = null;
let selectedHistoryMetric = 'overallScore';

const HISTORY_METRICS = {
    overallScore: {
        label: 'Overall Score',
        chartTitle: 'Overall Health Score Trend',
        color: '#667eea',
        min: 0,
        max: 100,
        stepSize: 20
    },
    bmi: {
        label: 'BMI',
        chartTitle: 'BMI Trend',
        color: '#f97316',
        min: 10,
        max: 45,
        stepSize: 5
    },
    sleepHours: {
        label: 'Sleep (hours/night)',
        chartTitle: 'Sleep Trend',
        color: '#06b6d4',
        min: 0,
        max: 12,
        stepSize: 2
    },
    exerciseHours: {
        label: 'Exercise (hours/week)',
        chartTitle: 'Exercise Trend',
        color: '#22c55e',
        min: 0,
        max: 12,
        stepSize: 2
    },
    stressLevel: {
        label: 'Stress Level',
        chartTitle: 'Stress Trend',
        color: '#ef4444',
        min: 1,
        max: 5,
        stepSize: 1
    },
    heartRate: {
        label: 'Heart Rate (bpm)',
        chartTitle: 'Heart Rate Trend',
        color: '#ec4899',
        min: 40,
        max: 120,
        stepSize: 10
    },
    systolic: {
        label: 'Systolic BP (mmHg)',
        chartTitle: 'Systolic Blood Pressure Trend',
        color: '#8b5cf6',
        min: 70,
        max: 180,
        stepSize: 10
    },
    diastolic: {
        label: 'Diastolic BP (mmHg)',
        chartTitle: 'Diastolic Blood Pressure Trend',
        color: '#a855f7',
        min: 40,
        max: 120,
        stepSize: 10
    }
};

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
        saveAssessmentToHistory(currentAssessmentData);
        
        // Display results
        displayResults(result);
        renderHistorySection();
        
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

    updatePostAssessmentCta(result);
}

function updatePostAssessmentCta(result) {
    const ctaTitle = document.getElementById('ctaTitle');
    const ctaMessage = document.getElementById('ctaMessage');
    const ctaPrimaryBtn = document.getElementById('ctaPrimaryBtn');

    let titleText = 'Next Step';
    let messageText = 'Get a personalized action plan based on your assessment.';
    let buttonText = 'Build My Action Plan';
    let aiPrompt = 'Create a practical weekly health action plan from my assessment results.';

    if (result.overallScore >= 85) {
        titleText = 'Keep Your Momentum';
        messageText = 'You are doing great. Build a maintenance plan to protect these results.';
        buttonText = 'Create Maintenance Plan';
        aiPrompt = 'I scored in the excellent range. Create a 7-day maintenance plan to keep my health score high.';
    } else if (result.overallScore >= 70) {
        titleText = 'Move From Good To Excellent';
        messageText = 'A focused weekly plan can help improve your lowest-scoring areas.';
        buttonText = 'Build Improvement Plan';
        aiPrompt = 'I scored in the good range. Create a 7-day plan to move from good to excellent health.';
    } else if (result.overallScore >= 50) {
        titleText = 'Start Your Recovery Plan';
        messageText = 'Take small daily actions to improve your sleep, activity, and stress levels.';
        buttonText = 'Start 7-Day Plan';
        aiPrompt = 'I scored in the fair range. Give me a simple 7-day recovery plan with daily goals.';
    } else {
        titleText = 'Act Now';
        messageText = 'Prioritize professional support and a clear daily routine for immediate improvement.';
        buttonText = 'Get Priority Plan';
        aiPrompt = 'I scored in needs improvement. Give me a gentle but urgent 7-day plan and tell me what to discuss with a healthcare professional.';
    }

    ctaTitle.innerHTML = `<i class="fas fa-bullseye"></i>${titleText}`;
    ctaMessage.textContent = messageText;
    ctaPrimaryBtn.innerHTML = `<i class="fas fa-route"></i>${buttonText}`;
    ctaPrimaryBtn.dataset.aiPrompt = aiPrompt;
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
const ctaPrimaryBtn = document.getElementById('ctaPrimaryBtn');

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

function saveAssessmentToHistory(assessmentData) {
    try {
        const history = getAssessmentHistory();
        const entry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: new Date().toISOString(),
            overallScore: assessmentData.overallScore,
            status: assessmentData.status,
            bmi: assessmentData.bmi,
            age: assessmentData.age,
            systolic: assessmentData.systolic,
            diastolic: assessmentData.diastolic,
            heartRate: assessmentData.heartRate,
            exerciseHours: assessmentData.exerciseHours,
            sleepHours: assessmentData.sleepHours,
            stressLevel: assessmentData.stressLevel
        };

        history.push(entry);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
        console.error('Failed to save assessment history:', error);
    }
}

function getAssessmentHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Failed to read assessment history:', error);
        return [];
    }
}

function getSavedScoreGoal() {
    const stored = localStorage.getItem(SCORE_GOAL_STORAGE_KEY);
    const parsed = parseInt(stored || '85', 10);
    if (Number.isNaN(parsed)) return 85;
    return Math.min(100, Math.max(1, parsed));
}

function saveScoreGoal(goalValue) {
    localStorage.setItem(SCORE_GOAL_STORAGE_KEY, String(goalValue));
}

function formatHistoryDate(isoDate) {
    const date = new Date(isoDate);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function renderHistorySection() {
    const historySection = document.getElementById('historySection');
    const historyList = document.getElementById('historyList');
    const history = getAssessmentHistory();
    const scoreGoalInput = document.getElementById('scoreGoalInput');
    const scoreGoal = getSavedScoreGoal();

    if (scoreGoalInput && scoreGoalInput.value !== String(scoreGoal)) {
        scoreGoalInput.value = String(scoreGoal);
    }

    if (!history.length) {
        historySection.style.display = 'none';
        return;
    }

    historySection.style.display = 'block';
    historyList.innerHTML = '';

    const sortedHistory = [...history].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const recent = sortedHistory.slice(0, 8);

    recent.forEach((entry) => {
        const card = document.createElement('div');
        card.className = 'history-item';
        card.innerHTML = `
            <div class="history-item-main">
                <strong>${entry.overallScore}/100</strong>
                <span>${entry.status}</span>
            </div>
            <div class="history-item-meta">
                <span>BMI ${entry.bmi}</span>
                <span>${entry.systolic}/${entry.diastolic} mmHg</span>
                <span>${formatHistoryDate(entry.createdAt)}</span>
            </div>
        `;
        historyList.appendChild(card);
    });

    const chronologicalHistory = [...history].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    renderTrendChart(chronologicalHistory);
    updateGoalProgress(chronologicalHistory, scoreGoal);
}

function updateGoalProgress(history, scoreGoal) {
    const progressBar = document.getElementById('goalProgressBar');
    const progressText = document.getElementById('goalProgressText');

    if (!progressBar || !progressText) return;
    if (!history.length) {
        progressBar.style.width = '0%';
        progressText.textContent = 'Set a target score to track your progress.';
        return;
    }

    const latest = history[history.length - 1];
    const latestScore = latest.overallScore;
    const percentage = Math.min(100, Math.round((latestScore / scoreGoal) * 100));
    const gap = scoreGoal - latestScore;

    progressBar.style.width = `${percentage}%`;

    if (gap <= 0) {
        progressText.textContent = `Goal reached. Latest score ${latestScore} is at or above your target ${scoreGoal}.`;
        progressBar.style.background = 'linear-gradient(90deg, #10b981 0%, #059669 100%)';
    } else {
        progressText.textContent = `${gap} points to go. Latest score: ${latestScore}, target: ${scoreGoal}.`;
        progressBar.style.background = 'linear-gradient(90deg, #22c55e 0%, #3b82f6 100%)';
    }
}

function renderTrendChart(history) {
    const canvas = document.getElementById('historyTrendChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const metricConfig = HISTORY_METRICS[selectedHistoryMetric] || HISTORY_METRICS.overallScore;

    const labels = history.map((entry) => {
        const date = new Date(entry.createdAt);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const metricData = history.map((entry) => {
        const value = entry[selectedHistoryMetric];
        return typeof value === 'number' ? value : null;
    });

    const trendTitle = document.querySelector('.history-chart-card h3');
    if (trendTitle) {
        trendTitle.innerHTML = `<i class="fas fa-chart-line"></i>${metricConfig.chartTitle}`;
    }

    if (trendChart) {
        trendChart.destroy();
    }

    trendChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: metricConfig.label,
                    data: metricData,
                    borderColor: metricConfig.color,
                    backgroundColor: `${metricConfig.color}33`,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    min: metricConfig.min,
                    max: metricConfig.max,
                    ticks: { stepSize: metricConfig.stepSize }
                }
            }
        }
    });
}

if (ctaPrimaryBtn) {
    ctaPrimaryBtn.addEventListener('click', () => {
        aiChatPanel.classList.add('active');
        aiChatBtn.style.display = 'none';
        chatInput.focus();

        const prompt = ctaPrimaryBtn.dataset.aiPrompt || 'Create a practical health action plan from my assessment results.';
        setTimeout(() => {
            chatInput.value = prompt;
        }, 300);
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

function sanitizeProfileId(rawId) {
    return (rawId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || '';
}

function getAuthUsername() {
    return localStorage.getItem(AUTH_USER_STORAGE_KEY) || '';
}

function setAuthSession(token, username) {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(AUTH_USER_STORAGE_KEY, username);
    updateAuthUI(username);
}

function clearAuthSession() {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    updateAuthUI('');
}

function getAuthHeaders() {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function updateAuthUI(username) {
    const authStatus = document.getElementById('authStatus');
    const authForms = document.getElementById('authForms');
    const authUsername = document.getElementById('authUsername');
    const syncProfileIdInput = document.getElementById('syncProfileId');
    const normalized = sanitizeProfileId(username);

    if (normalized) {
        if (authStatus) authStatus.style.display = 'flex';
        if (authForms) authForms.style.display = 'none';
        if (authUsername) authUsername.textContent = normalized;
        if (syncProfileIdInput) {
            syncProfileIdInput.value = normalized;
            syncProfileIdInput.readOnly = true;
        }
        localStorage.setItem(SYNC_PROFILE_STORAGE_KEY, normalized);
    } else {
        if (authStatus) authStatus.style.display = 'none';
        if (authForms) authForms.style.display = 'grid';
        if (authUsername) authUsername.textContent = '--';
        if (syncProfileIdInput) {
            syncProfileIdInput.readOnly = false;
            syncProfileIdInput.value = localStorage.getItem(SYNC_PROFILE_STORAGE_KEY) || '';
        }
    }
}

async function restoreAuthSession() {
    const token = getAuthToken();
    const localUser = getAuthUsername();

    if (!token || !localUser) {
        updateAuthUI('');
        return;
    }

    try {
        const response = await fetch('/api/auth/me', {
            headers: {
                ...getAuthHeaders()
            }
        });

        if (!response.ok) {
            clearAuthSession();
            return;
        }

        const payload = await response.json();
        const serverUser = sanitizeProfileId(payload.username || '');
        if (!serverUser) {
            clearAuthSession();
            return;
        }

        localStorage.setItem(AUTH_USER_STORAGE_KEY, serverUser);
        updateAuthUI(serverUser);
    } catch (error) {
        console.error('Session restore failed:', error);
        clearAuthSession();
    }
}

function getActiveProfileId() {
    const authUser = sanitizeProfileId(getAuthUsername());
    if (authUser) return authUser;

    const syncProfileIdInput = document.getElementById('syncProfileId');
    return sanitizeProfileId(syncProfileIdInput ? syncProfileIdInput.value : '');
}

// Welcome message on page load
window.addEventListener('load', () => {
    const scoreGoalInput = document.getElementById('scoreGoalInput');
    if (scoreGoalInput) {
        scoreGoalInput.value = String(getSavedScoreGoal());
    }

    const syncProfileIdInput = document.getElementById('syncProfileId');
    if (syncProfileIdInput) {
        syncProfileIdInput.value = localStorage.getItem(SYNC_PROFILE_STORAGE_KEY) || '';
    }

    restoreAuthSession();
    renderHistorySection();
    setTimeout(() => {
        showNotification('Welcome! Start your health assessment or chat with our AI assistant.', 'info');
    }, 1000);
});

const historyMetricSelect = document.getElementById('historyMetricSelect');
if (historyMetricSelect) {
    historyMetricSelect.addEventListener('change', (e) => {
        selectedHistoryMetric = e.target.value;
        renderHistorySection();
    });
}

const clearHistoryBtn = document.getElementById('clearHistoryBtn');
if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
        localStorage.removeItem(HISTORY_STORAGE_KEY);
        if (trendChart) {
            trendChart.destroy();
            trendChart = null;
        }
        renderHistorySection();
        showNotification('Assessment history cleared.', 'success');
    });
}

const saveGoalBtn = document.getElementById('saveGoalBtn');
if (saveGoalBtn) {
    saveGoalBtn.addEventListener('click', () => {
        const scoreGoalInput = document.getElementById('scoreGoalInput');
        if (!scoreGoalInput) return;

        const goal = parseInt(scoreGoalInput.value, 10);
        if (Number.isNaN(goal) || goal < 1 || goal > 100) {
            showNotification('Target score must be between 1 and 100.', 'error');
            return;
        }

        saveScoreGoal(goal);
        renderHistorySection();
        showNotification('Goal saved.', 'success');
    });
}

const syncSaveBtn = document.getElementById('syncSaveBtn');
if (syncSaveBtn) {
    syncSaveBtn.addEventListener('click', async () => {
        const syncProfileIdInput = document.getElementById('syncProfileId');
        if (!syncProfileIdInput) return;

        const profileId = getActiveProfileId();
        if (!profileId) {
            showNotification('Enter a valid Profile ID first.', 'error');
            return;
        }

        syncProfileIdInput.value = profileId;
        localStorage.setItem(SYNC_PROFILE_STORAGE_KEY, profileId);

        try {
            const response = await fetch('/api/history/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    profileId,
                    history: getAssessmentHistory(),
                    goalTarget: getSavedScoreGoal()
                })
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || 'Sync save failed');
            }

            showNotification('Cloud sync saved successfully.', 'success');
        } catch (error) {
            console.error('Sync save failed:', error);
            showNotification(`Save failed: ${error.message}`, 'error');
        }
    });
}

const syncLoadBtn = document.getElementById('syncLoadBtn');
if (syncLoadBtn) {
    syncLoadBtn.addEventListener('click', async () => {
        const syncProfileIdInput = document.getElementById('syncProfileId');
        if (!syncProfileIdInput) return;

        const profileId = getActiveProfileId();
        if (!profileId) {
            showNotification('Enter a valid Profile ID first.', 'error');
            return;
        }

        syncProfileIdInput.value = profileId;
        localStorage.setItem(SYNC_PROFILE_STORAGE_KEY, profileId);

        try {
            const response = await fetch(`/api/history/sync/${encodeURIComponent(profileId)}`);
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || 'Sync load failed');
            }

            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(payload.history || []));
            if (typeof payload.goalTarget === 'number') {
                saveScoreGoal(Math.min(100, Math.max(1, Math.round(payload.goalTarget))));
            }

            renderHistorySection();
            showNotification('Cloud data loaded.', 'success');
        } catch (error) {
            console.error('Sync load failed:', error);
            showNotification(`Load failed: ${error.message}`, 'error');
        }
    });
}

const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const usernameInput = document.getElementById('registerUsername');
        const passwordInput = document.getElementById('registerPassword');
        if (!usernameInput || !passwordInput) return;

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || 'Registration failed');
            }

            showNotification('Account created. You can now login.', 'success');
            registerForm.reset();

            const loginUsername = document.getElementById('loginUsername');
            if (loginUsername) {
                loginUsername.value = sanitizeProfileId(payload.username || username);
            }
        } catch (error) {
            console.error('Registration failed:', error);
            showNotification(`Register failed: ${error.message}`, 'error');
        }
    });
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const usernameInput = document.getElementById('loginUsername');
        const passwordInput = document.getElementById('loginPassword');
        if (!usernameInput || !passwordInput) return;

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || 'Login failed');
            }

            setAuthSession(payload.token, sanitizeProfileId(payload.username || username));
            loginForm.reset();
            showNotification('Logged in successfully.', 'success');
        } catch (error) {
            console.error('Login failed:', error);
            showNotification(`Login failed: ${error.message}`, 'error');
        }
    });
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    ...getAuthHeaders()
                }
            });
        } catch (error) {
            console.error('Logout request failed:', error);
        } finally {
            clearAuthSession();
            showNotification('Logged out.', 'success');
        }
    });
}
