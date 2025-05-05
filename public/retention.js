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

    // Function to set up user info in header
    function setupUserInfo(user) {
        const userInfoContainer = document.querySelector('.user-info');
        if (!userInfoContainer) return;

        userInfoContainer.innerHTML = `
            <span id="current-user">${user.name || 'Unknown'} (${user.role || 'user'})</span>
            <div class="user-actions">
                ${user.role === 'admin' ? '<a href="/users" class="admin-link">User Management</a>' : ''}
                ${user.role === 'admin' ? '<a href="/settings" class="admin-link">Settings</a>' : ''}
                ${user.role === 'admin' ? '<a href="/sites.html" class="admin-link">Sites</a>' : ''}
                ${user.role === 'admin' ? '<a href="/retention.html" class="admin-link active">Retention</a>' : ''}
                <button id="logout-btn" class="logout-button">Logout</button>
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
});