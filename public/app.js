document.addEventListener('DOMContentLoaded', function () {
    console.log('DOM content loaded, initializing app...');

    // DOM elements
    const eventsList = document.getElementById('events-list');
    const alertImage = document.getElementById('alert-image');
    const imageInfo = document.getElementById('image-info');
    const acknowledgeContainer = document.getElementById('acknowledge-container');
    const refreshBtn = document.getElementById('refresh-btn');
    const unacknowledgedCounter = document.getElementById('unacknowledged-counter');
    const filterUnacknowledged = document.getElementById('filter-unacknowledged');
    const filterLateResponse = document.getElementById('filter-late-response');
    const filterDateFrom = document.getElementById('filter-date-from');
    const filterDateTo = document.getElementById('filter-date-to');
    const clearDateFilterBtn = document.getElementById('clear-date-filter');
    const notificationSound = document.getElementById('notification-sound');
    const showShortcutsBtn = document.getElementById('show-shortcuts');
    const shortcutsPanel = document.getElementById('shortcuts-panel');

    // New elements for tags and notes
    let availableTags = [];
    let filterTagDropdown = null;
    const acknowledgeModal = document.getElementById('acknowledge-modal');
    const acknowledgeForm = document.getElementById('acknowledge-form');
    const ackEventId = document.getElementById('ack-event-id');
    const ackNote = document.getElementById('ack-note');
    const tagContainer = document.getElementById('tag-container');
    const ackCancelBtn = document.getElementById('ack-cancel-btn');
    const acknowledgeError = document.getElementById('acknowledge-error');
    const closeModalButtons = document.querySelectorAll('.close-modal');

    // New elements for event locking
    const ackLockEvent = document.getElementById('ack-lock-event');
    const eventLockContainer = document.getElementById('event-lock-container');

    // State
    let events = [];
    let selectedEventId = null;
    let polling = null;
    let eventSource = null; // For SSE
    let siteInfoCache = {}; // Cache for site information

    // Check if the user is logged in
    const token = localStorage.getItem('token');
    console.log('Auth token exists:', !!token);

    if (!token) {
        console.log('No token found, redirecting to login');
        window.location.href = '/login';
        return;
    }

    // Display current user
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    console.log('Current user:', currentUser);

    setupUserInfo(currentUser);

    // Admin links are now handled in the user actions section

    // Check if there's an event ID in the URL (for direct linking)
    const urlParams = new URLSearchParams(window.location.search);
    const eventIdParam = urlParams.get('event');
    if (eventIdParam) {
        console.log('Found event ID in URL:', eventIdParam);
        // We'll select this event after loading
    }

    // Fetch events from the server
    async function fetchEvents() {
        console.log('Fetching events with token:', token);
        try {
            const response = await fetch('/api/events', {
                headers: {
                    'x-auth-token': token
                }
            });

            console.log('Response status:', response.status);

            if (!response.ok) {
                throw new Error(`Failed to fetch events: ${response.status}`);
            }

            const data = await response.json();
            console.log('Events data received:', data);
            console.log('Number of events:', data.length);

            events = data;
            updateUnacknowledgedCounter();

            // Load site information for all events with siteId
            await loadSiteInformation(events);

            renderEventsList();

            // If an event is selected, update it with the latest data
            if (selectedEventId) {
                const event = events.find(e => e.id === selectedEventId);
                if (event) {
                    selectEvent(selectedEventId);
                }
            }
            // If there's an event ID in the URL, select it
            else if (eventIdParam) {
                const eventId = parseInt(eventIdParam);
                const event = events.find(e => e.id === eventId);
                if (event) {
                    selectEvent(eventId);
                    // Scroll to the selected event in the list
                    const eventElement = document.querySelector(`.event-item[data-id="${eventId}"]`);
                    if (eventElement) {
                        eventElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching events:', error);
            eventsList.innerHTML = '<div class="error">Failed to load events. Please try again.</div>';
        }
    }

    // Load site information for events with siteId
    async function loadSiteInformation(events) {
        console.log('Loading site information for events');

        // Get unique site IDs
        const siteIds = [...new Set(events.filter(e => e.siteId).map(e => e.siteId))];
        console.log('Found', siteIds.length, 'unique site IDs to load');

        if (siteIds.length === 0) return;

        // Load site information for each site ID
        const promises = siteIds.map(async siteId => {
            if (siteInfoCache[siteId]) {
                console.log('Using cached site info for site ID:', siteId);
                return;
            }

            try {
                const response = await fetch(`/api/sites/${siteId}`, {
                    headers: {
                        'x-auth-token': token
                    }
                });

                if (!response.ok) {
                    console.error(`Failed to fetch site info for site ID ${siteId}:`, response.status);
                    return;
                }

                const site = await response.json();
                console.log('Loaded site info for ID', siteId, ':', site.name);

                // Cache the site information
                siteInfoCache[siteId] = site;
            } catch (error) {
                console.error(`Error loading site info for site ID ${siteId}:`, error);
            }
        });

        // Wait for all site information to load
        await Promise.all(promises);
        console.log('Finished loading site information');
    }

    // Update the unacknowledged counter and related UI elements
    function updateUnacknowledgedCounter() {
        const count = events.filter(event => !event.acknowledged).length;
        console.log('Unacknowledged events count:', count);
        unacknowledgedCounter.textContent = count;

        if (count > 0) {
            unacknowledgedCounter.style.display = 'block';
        } else {
            unacknowledgedCounter.style.display = 'none';
        }
    }

    // Render the events list
    function renderEventsList() {
        console.log('Rendering events list with', events.length, 'events');

        if (events.length === 0) {
            console.log('No events found, showing empty message');
            eventsList.innerHTML = '<div class="loading">No alarm events found.</div>';
            return;
        }

        // Sort events by date (newest first)
        events.sort((a, b) => new Date(b.date) - new Date(a.date));
        console.log('Events sorted by date');

        // Apply filters
        let filteredEvents = events;

        // First apply unacknowledged filter if checked
        if (filterUnacknowledged.checked) {
            console.log('Filtering by unacknowledged events');
            filteredEvents = filteredEvents.filter(event => !event.acknowledged);
        }

        // Then apply late response filter if checked
        if (filterLateResponse.checked) {
            console.log('Filtering by late response events');
            filteredEvents = filteredEvents.filter(event => event.isLateResponse);
        }

        // Apply date range filter if either date is set
        if (filterDateFrom.value || filterDateTo.value) {
            console.log('Filtering by date range:', filterDateFrom.value, 'to', filterDateTo.value);
            
            // If only 'from' date is set
            if (filterDateFrom.value && !filterDateTo.value) {
                const fromDate = new Date(filterDateFrom.value);
                fromDate.setHours(0, 0, 0, 0); // Start of day
                
                filteredEvents = filteredEvents.filter(event => {
                    const eventDate = new Date(event.date);
                    return eventDate >= fromDate;
                });
            }
            // If only 'to' date is set
            else if (!filterDateFrom.value && filterDateTo.value) {
                const toDate = new Date(filterDateTo.value);
                toDate.setHours(23, 59, 59, 999); // End of day
                
                filteredEvents = filteredEvents.filter(event => {
                    const eventDate = new Date(event.date);
                    return eventDate <= toDate;
                });
            }
            // If both dates are set
            else if (filterDateFrom.value && filterDateTo.value) {
                const fromDate = new Date(filterDateFrom.value);
                fromDate.setHours(0, 0, 0, 0); // Start of day
                
                const toDate = new Date(filterDateTo.value);
                toDate.setHours(23, 59, 59, 999); // End of day
                
                filteredEvents = filteredEvents.filter(event => {
                    const eventDate = new Date(event.date);
                    return eventDate >= fromDate && eventDate <= toDate;
                });
            }
        }

        // Apply tag filter if selected
        if (filterTagDropdown && filterTagDropdown.value) {
            console.log('Filtering by tag:', filterTagDropdown.value);
            filteredEvents = filteredEvents.filter(event =>
                event.tags &&
                Array.isArray(event.tags) &&
                event.tags.includes(filterTagDropdown.value)
            );
        }

        console.log('Filtered events count:', filteredEvents.length);

        if (filteredEvents.length === 0) {
            let message = 'No events found matching the selected filters';

            if (filterUnacknowledged.checked && filterLateResponse.checked) {
                message = 'No unacknowledged late response events found';
            } else if (filterUnacknowledged.checked) {
                message = 'No unacknowledged events found';
            } else if (filterLateResponse.checked) {
                message = 'No late response events found';
            }

            if (filterTagDropdown && filterTagDropdown.value) {
                message += ` with tag '${filterTagDropdown.value}'`;
            }
            
            // Add date range information to message if dates are set
            if (filterDateFrom.value || filterDateTo.value) {
                if (filterDateFrom.value && filterDateTo.value) {
                    message += ` between ${new Date(filterDateFrom.value).toLocaleDateString()} and ${new Date(filterDateTo.value).toLocaleDateString()}`;
                } else if (filterDateFrom.value) {
                    message += ` from ${new Date(filterDateFrom.value).toLocaleDateString()} onwards`;
                } else if (filterDateTo.value) {
                    message += ` up to ${new Date(filterDateTo.value).toLocaleDateString()}`;
                }
            }

            console.log('No events after filtering, showing message:', message);
            eventsList.innerHTML = `<div class="loading">${message}.</div>`;
            return;
        }

        // Create HTML for events
        console.log('Building HTML for events');
        const eventsHTML = filteredEvents.map(event => {
            const date = new Date(event.date);
            const formattedDate = date.toLocaleString();
            const isActive = selectedEventId === event.id ? 'active' : '';
            const isAcknowledged = event.acknowledged ? '' : 'unacknowledged';
            const isLateResponse = event.isLateResponse ? 'late-response' : '';
            const isLocked = event.locked ? 'locked-event' : '';

            // Add check icon for acknowledged events
            const acknowledgedIcon = event.acknowledged
                ? '<span class="acknowledged-icon">✓</span>'
                : '';

            // Add lock icon for locked events
            const lockedIcon = event.locked
                ? '<span class="locked-icon">🔒</span>'
                : '';

            // Add response time info if the event has been acknowledged
            let responseTimeHTML = '';
            if (event.acknowledged && event.responseTimeMinutes !== undefined) {
                const lateClass = event.isLateResponse ? 'late' : '';
                responseTimeHTML = `<div class="response-time ${lateClass}">Response time: ${event.responseTimeMinutes} min</div>`;
            }

            // Add tags display
            let tagsHTML = '';
            if (event.tags && Array.isArray(event.tags) && event.tags.length > 0) {
                tagsHTML = '<div class="event-tags">';
                event.tags.forEach(tag => {
                    tagsHTML += `<span class="event-tag">${tag}</span>`;
                });
                tagsHTML += '</div>';
            }

            // Add site name if available
            let siteNameHTML = '';
            if (event.siteId && siteInfoCache[event.siteId]) {
                siteNameHTML = `<div class="event-site-name">Site: ${siteInfoCache[event.siteId].name}</div>`;
            }

            return `
            <div class="event-item ${isActive} ${isAcknowledged} ${isLateResponse} ${isLocked}" data-id="${event.id}">
                <div class="event-header">
                    <div class="event-subject">${event.subject}</div>
                    <div class="event-icons">
                        ${acknowledgedIcon}
                        ${lockedIcon}
                    </div>
                </div>
                <div class="event-details">
                    ${event.camera ? `<div>Camera: ${event.camera}</div>` : ''}
                    ${event.eventType ? `<div>Event: ${event.eventType}</div>` : ''}
                    ${siteNameHTML}
                    ${responseTimeHTML}
                    ${tagsHTML}
                </div>
                <div class="event-date">${formattedDate}</div>
            </div>
        `;
        }).join('');

        console.log('Setting events HTML');
        eventsList.innerHTML = eventsHTML;
        console.log('Events HTML set, adding event listeners');

        // Add event listeners to items
        document.querySelectorAll('.event-item').forEach(item => {
            item.addEventListener('click', function () {
                const eventId = parseInt(this.getAttribute('data-id'));
                selectEvent(eventId);
            });
        });
        console.log('Event listeners added to event items');
    }

    // Select an event and display its image
    function selectEvent(eventId) {
        console.log('Selecting event:', eventId);
        selectedEventId = eventId;

        // Update active class
        document.querySelectorAll('.event-item').forEach(item => {
            item.classList.remove('active');
        });

        const selectedItem = document.querySelector(`.event-item[data-id="${eventId}"]`);
        if (selectedItem) {
            selectedItem.classList.add('active');
            console.log('Set active class on selected event');
        } else {
            console.log('Warning: Could not find event item element for event ID:', eventId);
        }

        // Find the event
        const event = events.find(e => e.id === eventId);
        if (!event || !event.imagePath) {
            console.log('No image available for event:', event);
            imageInfo.innerHTML = '<p>No image available for this event</p>';
            alertImage.src = '';
            alertImage.alt = 'No image available';
            acknowledgeContainer.innerHTML = '';

            // Clear video container
            const videoContainer = document.getElementById('event-video-container');
            if (videoContainer) {
                videoContainer.innerHTML = '';
            }

            // Clear lock container
            if (eventLockContainer) {
                eventLockContainer.innerHTML = '';
            }

            return;
        }

        // Update image
        console.log('Setting image path:', event.imagePath);
        alertImage.src = event.imagePath;
        alertImage.alt = event.subject;

        // Update image info
        const date = new Date(event.date);
        let infoHTML = `
            <p><strong>${event.subject}</strong></p>
            <p>Captured: ${date.toLocaleString()}</p>
        `;

        if (event.camera) infoHTML += `<p>Camera: ${event.camera}</p>`;
        if (event.eventType) infoHTML += `<p>Event Type: ${event.eventType}</p>`;
        if (event.device) infoHTML += `<p>Device: ${event.device}</p>`;

        // Add tags if they exist
        if (event.tags && Array.isArray(event.tags) && event.tags.length > 0) {
            infoHTML += `<p>Tags: `;
            infoHTML += event.tags.map(tag => `<span class="event-tag">${tag}</span>`).join(' ');
            infoHTML += `</p>`;
        }

        // Add site information container if siteId exists
        if (event.siteId) {
            infoHTML += `<div id="site-info-container" class="site-info-container">
                <div class="site-info-loading">Loading site information...</div>
            </div>`;
        }

        // Add acknowledgment info if event has been acknowledged
        if (event.acknowledged && event.acknowledgedAt) {
            const ackDate = new Date(event.acknowledgedAt);
            infoHTML += `<div class="response-info">
                <p>Acknowledged: ${ackDate.toLocaleString()}`;

            if (event.acknowledgedBy) {
                infoHTML += ` by <strong>${event.acknowledgedBy.name}</strong>`;
            }

            infoHTML += `</p>`;

            if (event.responseTimeMinutes !== undefined) {
                const lateClass = event.isLateResponse ? 'late' : '';
                infoHTML += `<p class="response-time ${lateClass}">Response time: ${event.responseTimeMinutes} minutes`;

                if (event.isLateResponse) {
                    infoHTML += ' <strong>(Late Response)</strong>';
                }

                infoHTML += '</p>';
            }

            // Add note if it exists
            if (event.note) {
                infoHTML += `<div class="event-note">
                    <p><strong>Note:</strong></p>
                    <p>${event.note}</p>
                </div>`;
            }

            infoHTML += '</div>';
        }

        console.log('Setting image info HTML');
        imageInfo.innerHTML = infoHTML;

        // Update lock button display
        updateEventLockDisplay(event);

        // Fetch site information if siteId exists
        if (event.siteId) {
            console.log('Event has siteId, fetching site information:', event.siteId);
            fetchSiteInfo(event.siteId);
        }

        // Add acknowledge button if not acknowledged
        if (!event.acknowledged) {
            console.log('Event not acknowledged, showing acknowledge button');
            acknowledgeContainer.innerHTML = `
                <button id="acknowledge-btn" class="acknowledge-btn">Acknowledge Event</button>
            `;

            // Add event listener to acknowledge button
            document.getElementById('acknowledge-btn').addEventListener('click', () => {
                acknowledgeEvent(eventId);
            });
        } else {
            console.log('Event already acknowledged, no button needed');
            acknowledgeContainer.innerHTML = '';
        }

        // Check for matching video
        findMatchingVideo(event).then(videoInfo => {
            updateEventVideoDisplay(event, videoInfo);
        });
    }

    // Fetch site information
    async function fetchSiteInfo(siteId) {
        console.log('Fetching site info for siteId:', siteId);

        // Check if we already have this site info in cache
        if (siteInfoCache[siteId]) {
            console.log('Using cached site info for site ID:', siteId);
            updateSiteInfoDisplay(siteInfoCache[siteId]);
            return;
        }

        // Wait a moment before trying to get the container
        // This ensures the DOM has been updated
        setTimeout(async () => {
            const siteInfoContainer = document.getElementById('site-info-container');
            if (!siteInfoContainer) {
                console.error('Site info container not found in the DOM');
                return;
            }

            console.log('Found site info container, proceeding with fetch');

            try {
                const response = await fetch(`/api/sites/${siteId}`, {
                    headers: {
                        'x-auth-token': token
                    }
                });

                console.log('Site info API response status:', response.status);

                if (!response.ok) {
                    throw new Error(`Failed to fetch site information: ${response.status}`);
                }

                const site = await response.json();
                console.log('Site data received:', site);

                // Cache the site information
                siteInfoCache[siteId] = site;

                // Update the display
                updateSiteInfoDisplay(site);
            } catch (error) {
                console.error('Error fetching site information:', error);
                // Check if container still exists before updating
                if (document.getElementById('site-info-container')) {
                    siteInfoContainer.innerHTML = `<div class="site-info-error">Failed to load site information: ${error.message}</div>`;
                }
            }
        }, 100); // Small delay to ensure DOM is updated
    }

    // Update site info display with the given site data
    function updateSiteInfoDisplay(site) {
        const siteInfoContainer = document.getElementById('site-info-container');
        if (!siteInfoContainer) {
            console.error('Site info container not found when updating display');
            return;
        }

        // Generate keyholder info
        let keyholderHtml = '';
        const hasKeyholders = site.keyholders && site.keyholders.some(k => k.name || k.contact);

        if (hasKeyholders) {
            keyholderHtml = '<div class="site-keyholders"><h4>Keyholders</h4><ul>';
            site.keyholders.forEach(keyholder => {
                if (keyholder.name || keyholder.contact) {
                    keyholderHtml += `<li><strong>${keyholder.name || 'Unnamed'}</strong>: ${keyholder.contact || 'No contact'}</li>`;
                }
            });
            keyholderHtml += '</ul></div>';
        }

        // Update site info
        siteInfoContainer.innerHTML = `
            <div class="site-info-details">
                <h3 class="site-info-title">Site: ${site.name}</h3>
                <div class="site-info-address">
                    <h4>Address</h4>
                    <p>${site.address.replace(/\n/g, '<br>')}</p>
                </div>
                ${keyholderHtml}
            </div>
        `;
        console.log('Site info container updated successfully');
    }

    // Acknowledge an event
    function acknowledgeEvent(eventId) {
        // Open the acknowledge modal instead of immediately acknowledging
        openAcknowledgeModal(eventId);
    }

    // Process the acknowledge form submission
    async function processAcknowledgement(eventId, note, tags, locked) {
        console.log('Acknowledging event:', eventId, 'Note:', note, 'Tags:', tags, 'Locked:', locked);
        try {
            const response = await fetch(`/api/events/${eventId}/acknowledge`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': token
                },
                body: JSON.stringify({ note, tags, locked })
            });

            console.log('Acknowledge response status:', response.status);

            if (!response.ok) {
                throw new Error('Failed to acknowledge event');
            }

            const result = await response.json();
            console.log('Acknowledge result:', result);

            // Update the local event data
            const eventIndex = events.findIndex(e => e.id === eventId);
            if (eventIndex !== -1) {
                events[eventIndex] = result.event;
                console.log('Updated local event data');
            } else {
                console.log('Warning: Could not find event in local data to update');
            }

            // Update UI
            updateUnacknowledgedCounter();
            renderEventsList();

            // If the acknowledged event is the currently selected one, update its display
            if (selectedEventId === eventId) {
                selectEvent(eventId);
            }

            // Close the modal
            closeAcknowledgeModal();
        } catch (error) {
            console.error('Error acknowledging event:', error);
            acknowledgeError.textContent = 'Failed to acknowledge event. Please try again.';
        }
    }

    // Check for new emails/events
    async function checkForNewEvents() {
        console.log('Checking for new events');
        try {
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Checking...';

            const response = await fetch('/api/check-emails', {
                method: 'POST',
                headers: {
                    'x-auth-token': token
                }
            });

            console.log('Check emails response status:', response.status);
            const result = await response.json();
            console.log('Check emails result:', result);

            // Handle error response
            if (!result.success) {
                console.error('Error checking for new events:', result.error);
                showNotification(`Error checking for events: ${result.details || 'Unknown error'}`, 'error');
                // Still refresh events in case there are new ones from other sources
                await fetchEvents();
                return;
            }

            // Refresh the events list
            await fetchEvents();

            // Show a notification
            if (result.newEvents > 0) {
                console.log(`Found ${result.newEvents} new events`);
                showNotification(`Found ${result.newEvents} new alarm event${result.newEvents !== 1 ? 's' : ''}`, 'success');
                playNotificationSound();
            } else {
                console.log('No new events found');
                showNotification('No new alarm events found', 'info');
            }
        } catch (error) {
            console.error('Error checking for new events:', error);
            showNotification('Failed to check for new events. Please try again.', 'error');
            // Still try to fetch events
            await fetchEvents();
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Check for New Alerts';
        }
    }

    // Start real-time polling
    function startPolling() {
        console.log('Starting polling for updates');
        // Check for updates every 5 seconds - this just gets current events
        // The server is already checking for new emails in the background if enabled
        polling = setInterval(async () => {
            try {
                const previousCount = events.length;
                const previousIds = events.map(event => event.id);

                await fetchEvents();

                // Check if we have any new events
                const newEvents = events.filter(event => !previousIds.includes(event.id));

                if (newEvents.length > 0) {
                    console.log(`UI updated with ${newEvents.length} new events`);
                    showNotification(`${newEvents.length} new alarm event${newEvents.length > 1 ? 's' : ''} received`, 'success');
                    playNotificationSound();
                }
            } catch (error) {
                console.error('Error in automatic polling:', error);
                // Don't show notification for background polling errors to avoid
                // interrupting the user experience
            }
        }, 5 * 1000); // Check every 5 seconds
    }

    // Stop polling
    function stopPolling() {
        if (polling) {
            console.log('Stopping polling');
            clearInterval(polling);
            polling = null;
        }
    }

    // Connect to SSE for real-time updates
    function connectSSE() {
        // Close any existing connection
        if (eventSource) {
            console.log('Closing existing SSE connection');
            eventSource.close();
        }

        console.log('Connecting to SSE stream...');

        // Create a new EventSource connection
        eventSource = new EventSource('/api/events/updates');

        // Connection opened
        eventSource.addEventListener('open', function (e) {
            console.log('SSE connection established');
        });

        // Handle incoming messages
        eventSource.onmessage = function (e) {
            try {
                console.log('SSE event received:', e.data);
                const data = JSON.parse(e.data);

                if (data.type === 'new-events') {
                    console.log('Received notification about new events:', data.count);
                    // Refresh the events list to get the latest data
                    fetchEvents().then(() => {
                        // Show notification about new events
                        showNotification(`${data.count} new alarm event${data.count !== 1 ? 's' : ''} received`, 'success');
                        playNotificationSound();
                    });
                } else if (data.type === 'connected') {
                    console.log('SSE connection confirmed');
                }
            } catch (error) {
                console.error('Error processing SSE message:', error, e.data);
            }
        };

        // Handle errors
        eventSource.addEventListener('error', function (e) {
            console.error('SSE connection error', e);

            if (eventSource.readyState === EventSource.CLOSED) {
                console.log('SSE connection closed. Attempting to reconnect...');
                // Try to reconnect after a delay
                setTimeout(connectSSE, 5000);
            }
        });
    }

    // Show an in-app notification
    function showNotification(message, type = 'success') {
        console.log(`Showing notification (${type}):`, message);
        // Create notification element if it doesn't exist
        let notification = document.getElementById('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.className = 'notification';
            document.querySelector('.container').appendChild(notification);
        }

        // Clear any existing classes
        notification.className = 'notification';

        // Add the type class
        notification.classList.add(`notification-${type}`);

        // Set message and show
        notification.textContent = message;
        notification.classList.add('show');

        // Hide after 5 seconds
        setTimeout(() => {
            notification.classList.remove('show');
        }, 5000);
    }

    // Play notification sound
    function playNotificationSound() {
        try {
            // Reset the audio to the beginning
            notificationSound.currentTime = 0;
            // Play the sound
            notificationSound.play().catch(err => {
                console.warn('Could not play notification sound:', err);
                // Most browsers require user interaction before playing audio
            });
        } catch (err) {
            console.warn('Error playing notification sound:', err);
        }
    }

    // Handle visibility change to pause/resume polling
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            console.log('Page hidden, stopping polling');
            stopPolling();
            // Don't disconnect SSE when hidden, to ensure we get updates
        } else {
            console.log('Page visible, resuming polling');
            startPolling();
            // Reconnect SSE if needed
            if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
                connectSSE();
            }
        }
    });

    // Functions for tag features

    // Fetch available tags from server
    async function fetchAvailableTags() {
        try {
            const response = await fetch('/api/settings/tags', {
                headers: {
                    'x-auth-token': token
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch tags');
            }

            availableTags = await response.json();
            console.log('Available tags:', availableTags);

            // Update tag filter dropdown if it exists
            if (filterTagDropdown) {
                updateTagFilterDropdown();
            }
        } catch (error) {
            console.error('Error fetching tags:', error);
        }
    }

    // Update tag filter dropdown with available tags
    function updateTagFilterDropdown() {
        // Clear existing options except the first one (All tags)
        while (filterTagDropdown.options.length > 1) {
            filterTagDropdown.remove(1);
        }

        // Add options for each tag
        availableTags.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag;
            option.textContent = tag;
            filterTagDropdown.appendChild(option);
        });
    }

    // Create and add tag filter dropdown to events filter
    function createTagFilterDropdown() {
        const eventsFilter = document.querySelector('.events-filter');
        if (!eventsFilter) return;

        const tagFilterContainer = document.createElement('div');
        tagFilterContainer.className = 'tag-filter-container';

        const label = document.createElement('label');
        label.className = 'tag-filter-label';
        label.textContent = 'Filter by tag:';

        const select = document.createElement('select');
        select.id = 'filter-tag';
        select.className = 'tag-filter-dropdown';

        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'All tags';
        select.appendChild(defaultOption);

        // Add available tags if they exist
        if (availableTags.length > 0) {
            availableTags.forEach(tag => {
                const option = document.createElement('option');
                option.value = tag;
                option.textContent = tag;
                select.appendChild(option);
            });
        }

        // Add event listener for changes
        select.addEventListener('change', renderEventsList);

        tagFilterContainer.appendChild(label);
        tagFilterContainer.appendChild(select);
        eventsFilter.appendChild(tagFilterContainer);

        // Store the select element in the global variable
        filterTagDropdown = select;
    }

    // Open acknowledge modal
    function openAcknowledgeModal(eventId) {
        // Reset form
        acknowledgeForm.reset();
        acknowledgeError.textContent = '';
        ackEventId.value = eventId;

        // Reset lock checkbox - find the current event to set initial state
        const event = events.find(e => e.id === eventId);
        if (event) {
            ackLockEvent.checked = event.locked || false;
        } else {
            ackLockEvent.checked = false;
        }

        // Clear selected tags
        const existingTags = tagContainer.querySelectorAll('.tag-option');
        existingTags.forEach(tag => {
            tag.classList.remove('selected');
        });

        // Populate tags if they don't exist yet
        if (tagContainer.querySelector('.loading-tags')) {
            populateTagOptions();
        }

        // Show modal
        acknowledgeModal.style.display = 'block';
    }

    // Populate tag options in the modal
    function populateTagOptions() {
        if (!availableTags || availableTags.length === 0) {
            tagContainer.innerHTML = '<div class="no-tags">No tags available</div>';
            return;
        }

        let tagsHtml = '';
        availableTags.forEach(tag => {
            tagsHtml += `<div class="tag-option" data-tag="${tag}">${tag}</div>`;
        });

        tagContainer.innerHTML = tagsHtml;

        // Add click event listeners to tag options
        document.querySelectorAll('.tag-option').forEach(tagElement => {
            tagElement.addEventListener('click', function () {
                this.classList.toggle('selected');
            });
        });
    }

    // Close acknowledge modal
    function closeAcknowledgeModal() {
        acknowledgeModal.style.display = 'none';
    }

    /**
     * Update the lock/unlock button display based on event state
     * @param {Object} event - The event object
     */
    function updateEventLockDisplay(event) {
        if (!event || !eventLockContainer) return;

        if (event.locked) {
            // Event is locked - show unlock button and indicator
            eventLockContainer.innerHTML = `
                <div class="locked-indicator">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    This event is locked and will not be automatically deleted
                </div>
                <button id="unlock-event-btn" class="unlock-btn" data-id="${event.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
                    </svg>
                    Unlock Event
                </button>
            `;

            // Add event listener to unlock button
            document.getElementById('unlock-event-btn').addEventListener('click', function () {
                const eventId = parseInt(this.getAttribute('data-id'));
                toggleEventLock(eventId, false);
            });
        } else {
            // Event is not locked - show lock button
            eventLockContainer.innerHTML = `
                <button id="lock-event-btn" class="lock-btn" data-id="${event.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    Lock Event (Prevent Deletion)
                </button>
            `;

            // Add event listener to lock button
            document.getElementById('lock-event-btn').addEventListener('click', function () {
                const eventId = parseInt(this.getAttribute('data-id'));
                toggleEventLock(eventId, true);
            });
        }
    }

    /**
     * Toggle the lock status of an event
     * @param {number} eventId - The ID of the event to lock/unlock
     * @param {boolean} locked - The new lock status
     */
    async function toggleEventLock(eventId, locked) {
        try {
            console.log(`${locked ? 'Locking' : 'Unlocking'} event:`, eventId);

            const response = await fetch(`/api/retention/events/${eventId}/lock`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': token
                },
                body: JSON.stringify({ locked })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Failed to ${locked ? 'lock' : 'unlock'} event`);
            }

            const result = await response.json();
            console.log('Lock toggle result:', result);

            // Update the local event data
            const eventIndex = events.findIndex(e => e.id === eventId);
            if (eventIndex !== -1) {
                events[eventIndex].locked = locked;
            }

            // Update UI
            if (selectedEventId === eventId) {
                updateEventLockDisplay(events[eventIndex]);
            }

            // Refresh the events list to update any visual indicators
            renderEventsList();

            // Show notification
            showNotification(`Event ${locked ? 'locked' : 'unlocked'} successfully`, 'success');

        } catch (error) {
            console.error(`Error ${locked ? 'locking' : 'unlocking'} event:`, error);
            showNotification(`Failed to ${locked ? 'lock' : 'unlock'} event: ${error.message}`, 'error');
        }
    }

    // This function will be called when displaying event details

    /**
    * Check if a video file exists for the given event
    * @param {Object} event - The event object
    * @returns {Promise<{found: boolean, videoPath: string|null}>} - Object with found status and path
    */
    async function findMatchingVideo(event) {
        try {
            // Extract the timestamp from the image file
            if (!event.imagePath) return { found: false, videoPath: null };

            // Try to extract timestamp from image filename
            // Format: 1745505272552_01_20250424153418000.jpg
            const imageMatch = event.imagePath.match(/\d+_\d+_(\d{14})/);
            if (!imageMatch) return { found: false, videoPath: null };

            const imageTimestamp = imageMatch[1]; // 20250424153418000
            const dateTimePart = imageTimestamp.substr(0, 14); // 20250424153418

            // Get camera name from event
            const cameraName = event.camera || '';
            if (!cameraName) return { found: false, videoPath: null };

            // Format date parts for comparison
            const year = dateTimePart.substr(0, 4);
            const month = dateTimePart.substr(4, 2);
            const day = dateTimePart.substr(6, 2);
            const hour = dateTimePart.substr(8, 2);
            const minute = dateTimePart.substr(10, 2);
            const second = dateTimePart.substr(12, 2);

            // Create a date object for the image timestamp
            const imageDate = new Date(
                parseInt(year),
                parseInt(month) - 1, // JavaScript months are 0-based
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second)
            );

            // Check for video files within a window of time (e.g., 30 seconds before/after)
            const timeWindowMs = 30 * 1000; // 30 seconds

            // Create date string for the API call (format: YYYYMMDD)
            const dateStr = `${year}${month}${day}`;

            // Get video files for this camera and date
            const response = await fetch(`/api/videos/list?camera=${encodeURIComponent(cameraName)}&date=${dateStr}`, {
                headers: {
                    'x-auth-token': token
                }
            });

            if (!response.ok) {
                console.warn(`Failed to fetch video list: ${response.status}`);
                return { found: false, videoPath: null };
            }

            const videoFiles = await response.json();
            console.log(`Found ${videoFiles.length} videos for camera ${cameraName} on ${dateStr}`);

            // Find a video file with a timestamp close to the image timestamp
            let bestMatch = null;
            let minTimeDiff = Infinity;

            for (const videoPath of videoFiles) {
                // Extract the filename from the full path
                const filename = videoPath.split('/').pop();

                // Extract timestamp from video filename
                // Format: POD1_00_20250424153423.mp4
                const videoMatch = filename.match(/(\d{14})/);
                if (!videoMatch) continue;

                const videoTimestamp = videoMatch[1];

                // Parse video date components
                const vYear = videoTimestamp.substr(0, 4);
                const vMonth = videoTimestamp.substr(4, 2);
                const vDay = videoTimestamp.substr(6, 2);
                const vHour = videoTimestamp.substr(8, 2);
                const vMinute = videoTimestamp.substr(10, 2);
                const vSecond = videoTimestamp.substr(12, 2);

                // Create date object for video
                const videoDate = new Date(
                    parseInt(vYear),
                    parseInt(vMonth) - 1,
                    parseInt(vDay),
                    parseInt(vHour),
                    parseInt(vMinute),
                    parseInt(vSecond)
                );

                // Calculate time difference
                const timeDiff = Math.abs(videoDate.getTime() - imageDate.getTime());

                console.log(`Video: ${filename}, Time diff: ${timeDiff}ms`);

                // Update best match if this video is closer in time
                if (timeDiff < minTimeDiff && timeDiff <= timeWindowMs) {
                    minTimeDiff = timeDiff;
                    bestMatch = videoPath;
                }
            }

            if (bestMatch) {
                return {
                    found: true,
                    videoPath: `/videos/${bestMatch}`,
                    timeDifference: minTimeDiff
                };
            }

            // If we didn't find a match, try expanding search to all dates
            // This is useful if the event happens near midnight and the video
            // might be in the next day's directory
            if (videoFiles.length === 0) {
                console.log("No videos found for this date, expanding search to all dates");

                // Get all videos for this camera (without date restriction)
                const allResponse = await fetch(`/api/videos/list?camera=${encodeURIComponent(cameraName)}`, {
                    headers: {
                        'x-auth-token': token
                    }
                });

                if (!allResponse.ok) {
                    return { found: false, videoPath: null };
                }

                const allVideoFiles = await allResponse.json();
                console.log(`Found ${allVideoFiles.length} videos for camera ${cameraName} across all dates`);

                // Same matching logic as above
                for (const videoPath of allVideoFiles) {
                    const filename = videoPath.split('/').pop();
                    const videoMatch = filename.match(/(\d{14})/);
                    if (!videoMatch) continue;

                    const videoTimestamp = videoMatch[1];

                    // Parse video date components
                    const vYear = videoTimestamp.substr(0, 4);
                    const vMonth = videoTimestamp.substr(4, 2);
                    const vDay = videoTimestamp.substr(6, 2);
                    const vHour = videoTimestamp.substr(8, 2);
                    const vMinute = videoTimestamp.substr(10, 2);
                    const vSecond = videoTimestamp.substr(12, 2);

                    // Create date object for video
                    const videoDate = new Date(
                        parseInt(vYear),
                        parseInt(vMonth) - 1,
                        parseInt(vDay),
                        parseInt(vHour),
                        parseInt(vMinute),
                        parseInt(vSecond)
                    );

                    // Calculate time difference
                    const timeDiff = Math.abs(videoDate.getTime() - imageDate.getTime());

                    console.log(`Extended search - Video: ${filename}, Time diff: ${timeDiff}ms`);

                    // Use a larger time window for extended search (2 minutes)
                    const extendedTimeWindow = 120 * 1000;

                    // Update best match if this video is closer in time
                    if (timeDiff < minTimeDiff && timeDiff <= extendedTimeWindow) {
                        minTimeDiff = timeDiff;
                        bestMatch = videoPath;
                    }
                }

                if (bestMatch) {
                    return {
                        found: true,
                        videoPath: `/videos/${bestMatch}`,
                        timeDifference: minTimeDiff
                    };
                }
            }

            return { found: false, videoPath: null };
        } catch (error) {
            console.error('Error finding matching video:', error);
            return { found: false, videoPath: null };
        }
    }

    /**
 * Update video path directly in the events-data.json file
 * @param {number} eventId - ID of the event to update
 * @param {string} videoPath - Video path to store
 * @returns {boolean} - Success or failure
 */
    function updateEventWithVideoPathDirect(eventId, videoPath) {
        try {
            // Path to events data file
            const eventsFilePath = path.join(__dirname, 'events-data.json');

            // Read existing events
            const eventsData = fs.readFileSync(eventsFilePath, 'utf8');
            const events = JSON.parse(eventsData);

            // Find the event
            const eventIndex = events.findIndex(e => e.id === eventId);
            if (eventIndex === -1) {
                console.error(`Event ${eventId} not found in events data`);
                return false;
            }

            // Update the event
            events[eventIndex].videoPath = videoPath;

            // Write back to file
            fs.writeFileSync(eventsFilePath, JSON.stringify(events, null, 2));
            console.log(`Updated event ${eventId} with video path ${videoPath}`);
            return true;
        } catch (error) {
            console.error('Error updating event with video path directly:', error);
            return false;
        }
    }

    // Function to update the video display with a button to open modal
    function updateEventVideoDisplay(event, videoInfo) {
        const videoContainer = document.getElementById('event-video-container');
        if (!videoContainer) return;

        if (videoInfo.found && videoInfo.videoPath) {
            // Video found - show button to open the video in modal
            videoContainer.innerHTML = `
            <div class="video-available">
                <h3>Security Video</h3>
                <div class="video-placeholder">
                    <div class="placeholder-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="23 7 16 12 23 17 23 7"></polygon>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                    </div>
                    <p>Video available for this event</p>
                    <button id="open-video-btn" class="view-video-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polygon points="10 8 16 12 10 16 10 8"></polygon>
                        </svg>
                        View Video
                    </button>
                </div>
                <div class="video-info">
                    <span>Time difference: ${Math.round(videoInfo.timeDifference / 1000)} seconds</span>
                </div>
            </div>
        `;

            // Add event listener to the button
            document.getElementById('open-video-btn').addEventListener('click', function () {
                openVideoModal(videoInfo.videoPath, event, videoInfo.timeDifference);
            });

            // IMPORTANT: Update the event in the database through the API
            fetch('/api/events/update-video-path', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': token
                },
                body: JSON.stringify({
                    eventId: event.id,
                    videoPath: videoInfo.videoPath
                })
            })
                .then(response => {
                    if (response.ok) {
                        console.log(`Successfully stored video path for event ${event.id}`);
                        return response.json();
                    } else {
                        console.error(`Failed to store video path for event ${event.id}: ${response.status}`);
                        throw new Error(`API returned status ${response.status}`);
                    }
                })
                .then(data => {
                    console.log('Video path update response:', data);
                })
                .catch(error => {
                    console.error('Error updating video path:', error);
                });
        } else {
            // Get formatted date from event for the message
            const eventDate = new Date(event.date);
            const dateString = `${eventDate.getFullYear()}/${(eventDate.getMonth() + 1).toString().padStart(2, '0')}/${eventDate.getDate().toString().padStart(2, '0')}`;

            // No video yet - show placeholder
            videoContainer.innerHTML = `
            <div class="video-awaiting">
                <h3>Security Video</h3>
                <div class="video-placeholder">
                    <div class="placeholder-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="23 7 16 12 23 17 23 7"></polygon>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                    </div>
                    <p>Video Awaiting Upload...</p>
                    <div class="video-path-info">
                        Expected Path: <code>videos/${dateString}/...</code>
                    </div>
                    <button id="check-video-btn" class="secondary-button">Check Again</button>
                </div>
            </div>
        `;

            // Add event listener to the check button
            const checkBtn = document.getElementById('check-video-btn');
            if (checkBtn) {
                checkBtn.addEventListener('click', async () => {
                    // Show loading state
                    checkBtn.textContent = 'Checking...';
                    checkBtn.disabled = true;

                    // Check for video again
                    const updatedVideoInfo = await findMatchingVideo(event);
                    updateEventVideoDisplay(event, updatedVideoInfo);
                });
            }
        }
    }
    // Function to open the video modal
    function openVideoModal(videoPath, event, timeDifference) {
        // Get modal elements
        const videoModal = document.getElementById('video-modal');
        const modalVideoPlayer = document.getElementById('modal-video-player');
        const modalVideoTitle = document.getElementById('video-modal-title');
        const modalTimeDifference = document.getElementById('modal-time-difference');
        const modalDownloadLink = document.getElementById('modal-download-link');

        // Set video source
        const videoSource = modalVideoPlayer.querySelector('source');
        videoSource.src = videoPath;

        // Reset any existing styles that might be causing issues
        modalVideoPlayer.style.width = '100%';
        modalVideoPlayer.style.height = 'auto';
        modalVideoPlayer.style.maxHeight = '450px';

        // Load the video - important to reload with new source
        modalVideoPlayer.load();

        // Set modal title with camera info
        modalVideoTitle.textContent = `Security Video - ${event.camera || 'Unknown Camera'}`;

        // Set time difference info
        modalTimeDifference.textContent = `Time difference: ${Math.round(timeDifference / 1000)} seconds`;

        // Set download link
        modalDownloadLink.href = videoPath;

        // Show the modal
        videoModal.style.display = 'block';

        // Add event listener for video metadata loaded to ensure proper sizing
        modalVideoPlayer.addEventListener('loadedmetadata', function () {
            // Ensure video fits within container after metadata is loaded
            if (modalVideoPlayer.videoHeight > modalVideoPlayer.videoWidth * 1.5) {
                // Extra tall video - adjust height
                modalVideoPlayer.style.height = 'auto';
                modalVideoPlayer.style.maxHeight = '450px';
            } else {
                // Normal or wide video
                modalVideoPlayer.style.width = '100%';
                modalVideoPlayer.style.height = 'auto';
            }
        }, { once: true }); // Only run this once per video load

        // Play the video (with fallback for browsers that don't allow autoplay)
        modalVideoPlayer.play().catch(error => {
            console.warn('Auto-play failed:', error);
            // Most browsers require user interaction before video can play
        });
    }

    // Function to initialize the video modal
    function initVideoModal() {
        // Get modal and close button
        const videoModal = document.getElementById('video-modal');
        if (!videoModal) return; // Exit if modal doesn't exist

        const closeButtons = videoModal.querySelectorAll('.close-modal');

        // Add event listeners to close buttons
        closeButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Pause the video when closing
                const videoPlayer = document.getElementById('modal-video-player');
                if (videoPlayer) {
                    videoPlayer.pause();
                }
                videoModal.style.display = 'none';
            });
        });

        // Close when clicking outside the modal content
        window.addEventListener('click', (event) => {
            if (event.target === videoModal) {
                // Pause the video when closing
                const videoPlayer = document.getElementById('modal-video-player');
                if (videoPlayer) {
                    videoPlayer.pause();
                }
                videoModal.style.display = 'none';
            }
        });

        // Add keyboard shortcut (Escape) to close modal
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && videoModal.style.display === 'block') {
                // Pause the video when closing
                const videoPlayer = document.getElementById('modal-video-player');
                if (videoPlayer) {
                    videoPlayer.pause();
                }
                videoModal.style.display = 'none';
            }
        });
    }

    // Set up user info in header
    function setupUserInfo(user) {
        const userInfoContainer = document.getElementById('user-info-container');
        userInfoContainer.innerHTML = `
            <span class="current-user">Logged in as: ${user.name || 'Unknown'}</span>
            <div class="user-actions">
                ${user.role === 'admin' ? '<a href="/users" class="admin-link">User Management</a>' : ''}
                ${user.role === 'admin' ? '<a href="/settings" class="admin-link">Settings</a>' : ''}
                ${user.role === 'admin' ? '<a href="/sites.html" class="admin-link">Sites</a>' : ''}
                ${user.role === 'admin' ? '<a href="/retention.html" class="admin-link">Retention</a>' : ''}
                ${user.role === 'admin' ? '<a href="/operator-logs.html" class="admin-link">Operator Logs</a>' : ''}
                <button id="logout-btn" class="logout-btn">Logout</button>
            </div>
        `;
        console.log('Added user info container to header');

        // Initialize modal event listeners once to prevent duplication
        const logoutConfirmModal = document.getElementById('logout-confirm-modal');
        const logoutCancelBtn = document.getElementById('logout-cancel-btn');
        const logoutConfirmBtn = document.getElementById('logout-confirm-btn');
        const modalCloseBtn = logoutConfirmModal.querySelector('.close-modal');
            
        // Set up the cancel button event listener
        logoutCancelBtn.addEventListener('click', function() {
            logoutConfirmModal.style.display = 'none';
        });
            
        // Set up the close button event listener
        modalCloseBtn.addEventListener('click', function() {
            logoutConfirmModal.style.display = 'none';
        });
            
        // Add logout functionality
        document.getElementById('logout-btn').addEventListener('click', async function () {
            console.log('Logout button clicked');
            
            // Check if user is an operator
            if (user.role === 'operator') {
                // Get the count of unacknowledged events
                const unacknowledgedCount = events.filter(event => !event.acknowledged).length;
                
                // Set the unacknowledged count
                const unacknowledgedCountText = document.getElementById('unacknowledged-count-text');
                unacknowledgedCountText.textContent = unacknowledgedCount;
                
                // Show the modal
                logoutConfirmModal.style.display = 'block';
                
                // Define the confirm action with the current unacknowledged count
                logoutConfirmBtn.onclick = async function() {
                    // First log the operator logout with unacknowledged count
                    try {
                        const response = await fetch('/api/operator-logs', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-auth-token': token
                            },
                            body: JSON.stringify({ unacknowledgedCount })
                        });
                        
                        if (response.ok) {
                            console.log('Successfully logged operator logout');
                            // Proceed with logout only after successfully logging
                            performLogout();
                        } else {
                            console.error('Error logging operator logout: Server returned', response.status);
                            // Still perform logout even if logging fails
                            performLogout();
                        }
                    } catch (error) {
                        console.error('Error logging operator logout:', error);
                        // Still perform logout even if logging fails
                        performLogout();
                    }
                };
            } else {
                // Regular logout for non-operators
                performLogout();
            }
        });
        
        // Actual logout functionality
        async function performLogout() {
            try {
                // Call logout endpoint
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: {
                        'x-auth-token': token
                    }
                });

                // Clear local storage
                localStorage.removeItem('token');
                localStorage.removeItem('user');

                console.log('Logged out successfully, redirecting to login');
                // Redirect to login page
                window.location.href = '/login';
            } catch (error) {
                console.error('Logout error:', error);

                // Even if the server-side logout fails, clear local storage and redirect
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = '/login';
            }
        }
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
        // Don't trigger shortcuts when typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        // Escape key to close shortcuts panel and modals
        if (e.key === 'Escape') {
            if (shortcutsPanel.style.display === 'block') {
                shortcutsPanel.style.display = 'none';
            }
            if (acknowledgeModal.style.display === 'block') {
                closeAcknowledgeModal();
            }
            return;
        }

        // Up/Down arrows to navigate events
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault(); // Prevent page scrolling

            // Get all event items that are currently visible (respecting the filter)
            const visibleEvents = Array.from(document.querySelectorAll('.event-item'));
            if (visibleEvents.length === 0) return;

            // Find the current selected event index
            const currentIndex = visibleEvents.findIndex(el => el.classList.contains('active'));

            // Calculate the new index based on arrow key
            let newIndex;
            if (e.key === 'ArrowUp') {
                newIndex = currentIndex <= 0 ? visibleEvents.length - 1 : currentIndex - 1;
            } else {
                newIndex = currentIndex >= visibleEvents.length - 1 ? 0 : currentIndex + 1;
            }

            // Get the event ID and select it
            const eventId = parseInt(visibleEvents[newIndex].getAttribute('data-id'));
            selectEvent(eventId);

            // Ensure the selected item is visible in the scroll view
            visibleEvents[newIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        // 'A' key to acknowledge the currently selected event
        if (e.key === 'a' || e.key === 'A') {
            // Check if there's a selected event that's unacknowledged
            if (selectedEventId) {
                const event = events.find(e => e.id === selectedEventId);
                if (event && !event.acknowledged) {
                    acknowledgeEvent(selectedEventId);
                }
            }
        }

        // 'L' key to lock/unlock the currently selected event
        if (e.key === 'l' || e.key === 'L') {
            // Check if there's a selected event
            if (selectedEventId) {
                const event = events.find(e => e.id === selectedEventId);
                if (event) {
                    // Toggle the lock status
                    toggleEventLock(selectedEventId, !event.locked);
                }
            }
        }

        // 'R' key to refresh events (same as clicking the refresh button)
        if (e.key === 'r' || e.key === 'R') {
            if (!refreshBtn.disabled) {
                checkForNewEvents();
            }
        }

        // 'F' key to toggle unacknowledged filter
        if (e.key === 'f' || e.key === 'F') {
            filterUnacknowledged.checked = !filterUnacknowledged.checked;
            renderEventsList();
        }

        // 'T' key to focus on tag filter dropdown
        if ((e.key === 't' || e.key === 'T') && filterTagDropdown) {
            e.preventDefault();
            filterTagDropdown.focus();
        }
        
        // 'D' key to focus on date from filter
        if (e.key === 'd' || e.key === 'D') {
            e.preventDefault();
            filterDateFrom.focus();
        }
        
        // 'C' key to clear date filters
        if (e.key === 'c' || e.key === 'C') {
            e.preventDefault();
            filterDateFrom.value = '';
            filterDateTo.value = '';
            filterDateFrom.max = '';
            filterDateTo.min = '';
            renderEventsList();
        }
    });

    // Event listeners for the tag features

    // Handle acknowledge form submission
    acknowledgeForm.addEventListener('submit', function (e) {
        e.preventDefault();

        const eventId = parseInt(ackEventId.value);
        const note = ackNote.value.trim();
        const locked = ackLockEvent.checked;

        // Get selected tags
        const selectedTags = [];
        document.querySelectorAll('.tag-option.selected').forEach(tagElement => {
            selectedTags.push(tagElement.getAttribute('data-tag'));
        });

        processAcknowledgement(eventId, note, selectedTags, locked);
    });

    // Handle modal close buttons
    ackCancelBtn.addEventListener('click', closeAcknowledgeModal);
    closeModalButtons.forEach(btn => btn.addEventListener('click', closeAcknowledgeModal));

    // Close modal when clicking outside
    window.addEventListener('click', function (event) {
        if (event.target === acknowledgeModal) {
            closeAcknowledgeModal();
        }
    });

    // Shortcuts panel toggle
    showShortcutsBtn.addEventListener('click', () => {
        shortcutsPanel.style.display = shortcutsPanel.style.display === 'none' ? 'block' : 'none';
    });

    // Event listeners for filters
    filterUnacknowledged.addEventListener('change', renderEventsList);
    filterLateResponse.addEventListener('change', renderEventsList);
    
    // Date filter event listeners
    filterDateFrom.addEventListener('change', function() {
        // When "from" date changes, update "to" date's min attribute
        if (filterDateFrom.value) {
            filterDateTo.min = filterDateFrom.value;
        } else {
            filterDateTo.min = ''; // Reset min constraint if from date is cleared
        }
        renderEventsList();
    });
    
    filterDateTo.addEventListener('change', function() {
        // When "to" date changes, update "from" date's max attribute
        if (filterDateTo.value) {
            filterDateFrom.max = filterDateTo.value;
        } else {
            filterDateFrom.max = ''; // Reset max constraint if to date is cleared
        }
        renderEventsList();
    });
    
    // Clear date filter button
    clearDateFilterBtn.addEventListener('click', function() {
        filterDateFrom.value = '';
        filterDateTo.value = '';
        renderEventsList();
    });
    
    // Initialize date filter controls
    const today = new Date();
    const formattedToday = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    
    // Set max date for "to" date picker (can't select future dates)
    filterDateTo.max = formattedToday;
    
    // Restore date picker constraints if values are already set
    if (filterDateFrom.value && filterDateTo.value) {
        filterDateTo.min = filterDateFrom.value;
        filterDateFrom.max = filterDateTo.value;
    }

    // Handle click on the refresh button
    refreshBtn.addEventListener('click', checkForNewEvents);

    // Initial load
    console.log('Starting initial fetch of events...');
    fetchEvents();

    // Fetch available tags
    fetchAvailableTags().then(() => {
        createTagFilterDropdown();
    });

    // Start polling
    startPolling();

    // Connect to SSE for real-time updates
    connectSSE();

    // Init Video Modal
    initVideoModal();

    console.log('Initialization complete');
});