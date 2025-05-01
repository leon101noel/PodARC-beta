document.addEventListener('DOMContentLoaded', function () {
    // Check if the user is logged in
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    // Current user
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    setupUserInfo(currentUser);

    // Elements
    const avgResponseTimeEl = document.getElementById('avg-response-time');
    const totalEventsEl = document.getElementById('total-events');
    const lateResponsesEl = document.getElementById('late-responses');
    const responseRateEl = document.getElementById('response-rate');
    const userPerformanceBody = document.getElementById('user-performance-body');
    const recentResponsesBody = document.getElementById('recent-responses-body');
    const timeRangeButtons = document.querySelectorAll('.time-btn');

    // Charts
    let responseTimeChart;
    let eventTypeChart;
    let cameraResponseChart;
    let tagStatsChart;

    // Data
    let allEvents = [];
    let selectedTimeRange = 7; // Default to 7 days

    // Fetch events data
    fetchEvents();

    // Add event listeners to time range buttons
    timeRangeButtons.forEach(button => {
        button.addEventListener('click', function () {
            // Remove active class from all buttons
            timeRangeButtons.forEach(btn => btn.classList.remove('active'));

            // Add active class to clicked button
            this.classList.add('active');

            // Update time range and refresh charts
            selectedTimeRange = parseInt(this.getAttribute('data-days'));
            updateCharts();
        });
    });

    // Function to set up user info in header
    function setupUserInfo(user) {
        const userInfoContainer = document.getElementById('user-info-container');
        userInfoContainer.innerHTML = `
            <span class="current-user">Logged in as: ${user.name || 'Unknown'}</span>
            <div class="user-actions">
                ${user.role === 'admin' ? '<a href="/users" class="admin-link">User Management</a>' : ''}
                <button id="logout-btn" class="logout-btn">Logout</button>
            </div>
        `;

        // Add logout functionality
        document.getElementById('logout-btn').addEventListener('click', async function () {
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: {
                        'x-auth-token': token
                    }
                });

                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = '/login';
            } catch (error) {
                console.error('Logout error:', error);
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = '/login';
            }
        });
    }

    // Fetch all events
    async function fetchEvents() {
        try {
            const response = await fetch('/api/events', {
                headers: {
                    'x-auth-token': token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch events: ${response.status}`);
            }

            allEvents = await response.json();

            // Process and display data
            processData();
            updateCharts();
            generateUserPerformanceTable();
            generateRecentResponsesTable();

        } catch (error) {
            console.error('Error fetching events:', error);
            // Display error messages in respective containers
            avgResponseTimeEl.textContent = 'Error';
            totalEventsEl.textContent = 'Error';
            lateResponsesEl.textContent = 'Error';
            responseRateEl.textContent = 'Error';
            userPerformanceBody.innerHTML = '<tr><td colspan="5" class="loading-text">Error loading data</td></tr>';
            recentResponsesBody.innerHTML = '<tr><td colspan="6" class="loading-text">Error loading data</td></tr>';
        }
    }

    // Process event data to calculate statistics
    function processData() {
        // Filter acknowledged events
        const acknowledgedEvents = allEvents.filter(event => event.acknowledged && event.responseTimeMinutes !== undefined);

        // Calculate total events
        const totalEvents = allEvents.length;
        const acknowledgedCount = acknowledgedEvents.length;

        // Calculate response rate
        const responseRate = totalEvents > 0 ? Math.round((acknowledgedCount / totalEvents) * 100) : 0;

        // Calculate average response time
        let totalResponseTime = 0;
        acknowledgedEvents.forEach(event => {
            totalResponseTime += event.responseTimeMinutes || 0;
        });
        const avgResponseTime = acknowledgedCount > 0 ? (totalResponseTime / acknowledgedCount).toFixed(1) : 0;

        // Count late responses
        const lateResponses = acknowledgedEvents.filter(event => event.isLateResponse).length;

        // Update summary elements
        avgResponseTimeEl.textContent = avgResponseTime;
        totalEventsEl.textContent = totalEvents;
        lateResponsesEl.textContent = lateResponses;
        responseRateEl.textContent = responseRate + '%';
    }

    // Update all charts with current data and selected time range
    function updateCharts() {
        // Get date for filtering by selected time range
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - selectedTimeRange);

        // Filter events within the selected time range
        const filteredEvents = allEvents.filter(event => new Date(event.date) >= cutoffDate);

        updateResponseTimeChart(filteredEvents);
        updateEventTypeChart(filteredEvents);
        updateCameraResponseChart(filteredEvents);
        updateTagStatsChart(filteredEvents);
    }

    // Create/update response time trend chart
    function updateResponseTimeChart(events) {
        // Sort events by date
        const sortedEvents = [...events].sort((a, b) => new Date(a.date) - new Date(b.date));

        // Group events by day
        const eventsByDay = {};

        sortedEvents.forEach(event => {
            const date = new Date(event.date).toLocaleDateString();

            if (!eventsByDay[date]) {
                eventsByDay[date] = {
                    totalResponseTime: 0,
                    count: 0
                };
            }

            if (event.acknowledged && event.responseTimeMinutes !== undefined) {
                eventsByDay[date].totalResponseTime += event.responseTimeMinutes;
                eventsByDay[date].count++;
            }
        });

        // Calculate daily averages
        const labels = [];
        const data = [];

        for (const date in eventsByDay) {
            labels.push(date);
            const avgTime = eventsByDay[date].count > 0
                ? eventsByDay[date].totalResponseTime / eventsByDay[date].count
                : 0;
            data.push(avgTime.toFixed(1));
        }

        // Create or update chart
        const ctx = document.getElementById('response-time-chart').getContext('2d');

        if (responseTimeChart) {
            responseTimeChart.data.labels = labels;
            responseTimeChart.data.datasets[0].data = data;
            responseTimeChart.update();
        } else {
            responseTimeChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Avg. Response Time (min)',
                        data: data,
                        backgroundColor: 'rgba(52, 152, 219, 0.2)',
                        borderColor: 'rgba(52, 152, 219, 1)',
                        borderWidth: 2,
                        tension: 0.3,
                        pointRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Minutes'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Date'
                            }
                        }
                    },
                    plugins: {
                        title: {
                            display: false
                        },
                        legend: {
                            position: 'top'
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    return `${context.dataset.label}: ${context.raw} min`;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // Create/update event type chart
    function updateEventTypeChart(events) {
        // Count events by type
        const eventTypes = {};

        events.forEach(event => {
            const type = event.eventType || 'Unknown';
            eventTypes[type] = (eventTypes[type] || 0) + 1;
        });

        // Prepare data for chart
        const labels = Object.keys(eventTypes);
        const data = Object.values(eventTypes);
        const backgroundColors = [
            'rgba(52, 152, 219, 0.7)', // Blue
            'rgba(231, 76, 60, 0.7)',  // Red
            'rgba(46, 204, 113, 0.7)', // Green
            'rgba(241, 196, 15, 0.7)', // Yellow
            'rgba(155, 89, 182, 0.7)'  // Purple
        ];

        // Create or update chart
        const ctx = document.getElementById('event-type-chart').getContext('2d');

        if (eventTypeChart) {
            eventTypeChart.data.labels = labels;
            eventTypeChart.data.datasets[0].data = data;
            eventTypeChart.update();
        } else {
            eventTypeChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: backgroundColors,
                        borderColor: 'rgba(255, 255, 255, 0.8)',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right'
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const label = context.label || '';
                                    const value = context.raw || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = Math.round((value / total) * 100);
                                    return `${label}: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // Create/update camera response chart
    function updateCameraResponseChart(events) {
        // Group events by camera and calculate avg response time
        const cameraData = {};

        events.forEach(event => {
            if (!event.camera || !event.acknowledged || event.responseTimeMinutes === undefined) return;

            if (!cameraData[event.camera]) {
                cameraData[event.camera] = {
                    totalResponseTime: 0,
                    count: 0
                };
            }

            cameraData[event.camera].totalResponseTime += event.responseTimeMinutes;
            cameraData[event.camera].count++;
        });

        // Calculate averages and prepare data
        const labels = [];
        const data = [];

        for (const camera in cameraData) {
            if (cameraData[camera].count > 0) {
                labels.push(camera);
                const avgTime = cameraData[camera].totalResponseTime / cameraData[camera].count;
                data.push(avgTime.toFixed(1));
            }
        }

        // Create a custom color array based on response times
        const backgroundColors = data.map(value => {
            const val = parseFloat(value);
            if (val <= 1) return 'rgba(46, 204, 113, 0.7)'; // Good: Green
            if (val <= 2) return 'rgba(241, 196, 15, 0.7)'; // Average: Yellow
            return 'rgba(231, 76, 60, 0.7)'; // Poor: Red
        });

        // Create or update chart
        const ctx = document.getElementById('camera-response-chart').getContext('2d');

        if (cameraResponseChart) {
            cameraResponseChart.data.labels = labels;
            cameraResponseChart.data.datasets[0].data = data;
            cameraResponseChart.data.datasets[0].backgroundColor = backgroundColors;
            cameraResponseChart.update();
        } else {
            cameraResponseChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Avg. Response Time (min)',
                        data: data,
                        backgroundColor: backgroundColors,
                        borderColor: 'rgba(255, 255, 255, 0.8)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Minutes'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Camera'
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        }
                    }
                }
            });
        }
    }

    // Function to create the tag statistics chart
    function updateTagStatsChart(events) {
        // Count events by tag
        const tagCounts = {};

        events.forEach(event => {
            if (event.tags && Array.isArray(event.tags) && event.tags.length > 0) {
                event.tags.forEach(tag => {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
            }
        });

        // Sort tags by count (descending)
        const sortedTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10); // Limit to top 10 tags

        // Prepare data for chart
        const labels = sortedTags.map(item => item[0]);
        const data = sortedTags.map(item => item[1]);

        // Generate colors
        const backgroundColors = [
            'rgba(52, 152, 219, 0.7)',  // Blue
            'rgba(46, 204, 113, 0.7)',  // Green
            'rgba(231, 76, 60, 0.7)',   // Red
            'rgba(241, 196, 15, 0.7)',  // Yellow
            'rgba(155, 89, 182, 0.7)',  // Purple
            'rgba(52, 73, 94, 0.7)',    // Dark Blue
            'rgba(26, 188, 156, 0.7)',  // Turquoise
            'rgba(230, 126, 34, 0.7)',  // Orange
            'rgba(149, 165, 166, 0.7)', // Gray
            'rgba(211, 84, 0, 0.7)'     // Dark Orange
        ];

        // Create or update chart
        const ctx = document.getElementById('tag-stats-chart').getContext('2d');

        if (tagStatsChart) {
            tagStatsChart.data.labels = labels;
            tagStatsChart.data.datasets[0].data = data;
            tagStatsChart.update();
        } else {
            tagStatsChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Events by Tag',
                        data: data,
                        backgroundColor: backgroundColors,
                        borderColor: 'rgba(255, 255, 255, 0.8)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Events'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Tag'
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    return `${context.label}: ${context.raw} events`;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // Generate the user performance table
    function generateUserPerformanceTable() {
        // Group events by user who acknowledged them
        const userPerformance = {};

        allEvents.forEach(event => {
            if (!event.acknowledged || !event.acknowledgedBy) return;

            const userId = event.acknowledgedBy.userId;
            const userName = event.acknowledgedBy.name || 'Unknown';

            if (!userPerformance[userId]) {
                userPerformance[userId] = {
                    name: userName,
                    totalEvents: 0,
                    totalResponseTime: 0,
                    lateResponses: 0,
                    tags: {} // Add this for tracking tags
                };
            }

            userPerformance[userId].totalEvents++;

            if (event.responseTimeMinutes !== undefined) {
                userPerformance[userId].totalResponseTime += event.responseTimeMinutes;

                if (event.isLateResponse) {
                    userPerformance[userId].lateResponses++;
                }
            }

            // Count tags used by this user
            if (event.tags && Array.isArray(event.tags)) {
                event.tags.forEach(tag => {
                    userPerformance[userId].tags[tag] = (userPerformance[userId].tags[tag] || 0) + 1;
                });
            }
        });

        // Generate table rows
        let tableHtml = '';

        // Convert to array for sorting
        const userPerformanceArray = Object.entries(userPerformance).map(([userId, data]) => ({
            userId,
            ...data
        }));

        // Sort by number of events acknowledged (descending)
        userPerformanceArray.sort((a, b) => b.totalEvents - a.totalEvents);

        userPerformanceArray.forEach(user => {
            const avgResponseTime = user.totalEvents > 0
                ? (user.totalResponseTime / user.totalEvents).toFixed(1)
                : 0;

            const latePercentage = user.totalEvents > 0
                ? Math.round((user.lateResponses / user.totalEvents) * 100)
                : 0;

            // Calculate performance score (lower is better)
            // Score is based on average response time and percentage of late responses
            const performanceScore = user.totalEvents > 0
                ? (avgResponseTime * 0.7) + (latePercentage * 0.3)
                : 0;

            let performanceClass = 'good';
            if (performanceScore > 5) {
                performanceClass = 'poor';
            } else if (performanceScore > 2) {
                performanceClass = 'average';
            }

            const performancePercent = Math.max(0, Math.min(100, 100 - (performanceScore * 10)));

            // Generate most used tags
            let mostUsedTags = '';
            if (user.tags && Object.keys(user.tags).length > 0) {
                // Sort tags by count
                const sortedTags = Object.entries(user.tags)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3); // Top 3 tags

                if (sortedTags.length > 0) {
                    mostUsedTags = sortedTags.map(([tag, count]) =>
                        `<span class="user-tag">${tag} (${count})</span>`
                    ).join(' ');
                } else {
                    mostUsedTags = 'None';
                }
            } else {
                mostUsedTags = 'None';
            }

            tableHtml += `
            <tr>
                <td>${user.name}</td>
                <td>${user.totalEvents}</td>
                <td>${avgResponseTime} min</td>
                <td>${user.lateResponses} (${latePercentage}%)</td>
                <td>${mostUsedTags}</td>
                <td>
                    <div class="performance-indicator">
                        <div class="performance-bar performance-${performanceClass}" style="width: ${performancePercent}%"></div>
                    </div>
                </td>
            </tr>
        `;
        });

        // If no users found
        if (userPerformanceArray.length === 0) {
            tableHtml = '<tr><td colspan="6" class="loading-text">No response data available</td></tr>';
        }

        userPerformanceBody.innerHTML = tableHtml;
    }

    // Generate the recent responses table
    function generateRecentResponsesTable() {
        // Filter acknowledged events
        const acknowledgedEvents = allEvents.filter(event =>
            event.acknowledged &&
            event.acknowledgedAt &&
            event.responseTimeMinutes !== undefined
        );

        // Sort by acknowledgement date (newest first)
        acknowledgedEvents.sort((a, b) => new Date(b.acknowledgedAt) - new Date(a.acknowledgedAt));

        // Take only the most recent 20 events
        const recentEvents = acknowledgedEvents.slice(0, 20);

        // Generate table rows
        let tableHtml = '';

        recentEvents.forEach(event => {
            const eventDate = new Date(event.date).toLocaleString();
            const statusClass = event.isLateResponse ? 'status-late' : 'status-ontime';
            const statusText = event.isLateResponse ? 'Late' : 'On Time';
            const acknowledgedBy = event.acknowledgedBy ? event.acknowledgedBy.name : 'Unknown';

            // Generate tags HTML
            let tagsHtml = '';
            if (event.tags && Array.isArray(event.tags) && event.tags.length > 0) {
                tagsHtml = event.tags.map(tag =>
                    `<span class="event-tag">${tag}</span>`
                ).join(' ');
            } else {
                tagsHtml = '<span class="no-tags">None</span>';
            }

            tableHtml += `
            <tr>
                <td>${eventDate}</td>
                <td>${event.eventType || 'Unknown'}</td>
                <td>${event.camera || 'Unknown'}</td>
                <td>${event.responseTimeMinutes} min</td>
                <td><span class="response-status ${statusClass}">${statusText}</span></td>
                <td>${tagsHtml}</td>
                <td>${acknowledgedBy}</td>
            </tr>
        `;
        });

        // If no events found
        if (recentEvents.length === 0) {
            tableHtml = '<tr><td colspan="7" class="loading-text">No recent responses available</td></tr>';
        }

        recentResponsesBody.innerHTML = tableHtml;
    }
});