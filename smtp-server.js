// smtp-server.js
const SMTPServer = require('smtp-server').SMTPServer;
const simpleParser = require('mailparser').simpleParser;
const path = require('path');
const fs = require('fs');
const util = require('util');

// Store event handler
let onEmailReceivedHandler = null;

// SMTP Authentication Configuration
// Replace these values with your desired username and password
const SMTP_AUTH = {
    user: "cctv@cctv.com",
    pass: "cctv"
};

// Settings for the SMTP server
const config = {
    port: process.env.SMTP_PORT || 2525,
    host: process.env.SMTP_HOST || '0.0.0.0',
    // Set to true to use TLS (requires key and cert)
    secure: false,
    // Remove AUTH from disabledCommands to enable authentication
    disabledCommands: ['STARTTLS'],
    // Maximum allowed message size in bytes
    size: 25 * 1024 * 1024, // 25MB
    // Optional certificate files for TLS
    // key: fs.readFileSync('private-key.pem'),
    // cert: fs.readFileSync('server-cert.pem'),
    logger: process.env.NODE_ENV === 'development',
    // Authentication settings
    authMethods: ['PLAIN', 'LOGIN']
};

/**
 * Initialize SMTP server and handle incoming messages
 * @param {Function} onEmailReceived - Callback function to handle new emails
 * @returns {Object} SMTP server instance
 */
function initSmtpServer(onEmailReceived) {
    // Store the callback
    onEmailReceivedHandler = onEmailReceived;

    // Create the SMTP server
    const server = new SMTPServer({
        secure: config.secure,
        size: config.size,
        disabledCommands: config.disabledCommands,
        authMethods: config.authMethods,

        // Handle authentication - simple fixed username/password check
        onAuth(auth, session, callback) {
            // Check if username and password match
            if (auth.username === SMTP_AUTH.user && auth.password === SMTP_AUTH.pass) {
                console.log(`SMTP: Authentication successful for user ${auth.username}`);
                return callback(null, { user: auth.username });
            }

            console.log(`SMTP: Authentication failed for user ${auth.username}`);
            return callback(new Error('Invalid username or password'));
        },

        onData(stream, session, callback) {
            // Buffer for collecting email data
            let mailDataChunks = [];

            stream.on('data', (chunk) => {
                mailDataChunks.push(chunk);
            });

            stream.on('end', async () => {
                try {
                    // Combine chunks to form the complete email
                    const mailData = Buffer.concat(mailDataChunks);

                    // Parse email
                    const parsed = await simpleParser(mailData);
                    console.log(`SMTP: Received email: ${parsed.subject}`);

                    // Log authenticated user if available
                    if (session.user) {
                        console.log(`SMTP: Email received from authenticated user: ${session.user}`);
                    }

                    // Process attachments if any
                    const attachments = [];

                    if (parsed.attachments && parsed.attachments.length > 0) {
                        for (const attachment of parsed.attachments) {
                            if (attachment.contentType && attachment.contentType.includes('image')) {
                                attachments.push({
                                    filename: attachment.filename,
                                    contentType: attachment.contentType,
                                    content: attachment.content
                                });
                            }
                        }
                    }

                    // Extract HTML content if present (some cameras embed images in HTML)
                    let htmlContent = null;
                    if (parsed.html) {
                        htmlContent = parsed.html;
                    }

                    // Call the handler with the parsed email data
                    if (onEmailReceivedHandler) {
                        onEmailReceivedHandler({
                            from: parsed.from?.text || '',
                            to: parsed.to?.text || '',
                            subject: parsed.subject || '',
                            text: parsed.text || '',
                            html: htmlContent,
                            date: parsed.date || new Date(),
                            attachments: attachments,
                            messageId: parsed.messageId || `generated-${Date.now()}`,
                            authenticated: !!session.user,
                            authenticatedUser: session.user
                        });
                    }

                    // Acknowledge the receipt to the sender
                    callback();
                } catch (error) {
                    console.error('Error processing email:', error);
                    // Still acknowledge to avoid hanging connections
                    callback();
                }
            });

            stream.on('error', (error) => {
                console.error('Error in SMTP stream:', error);
                callback(error);
            });
        },

        onConnect(session, callback) {
            // Log connection in development mode
            if (config.logger) {
                console.log(`SMTP: New connection from ${session.remoteAddress}`);
            }

            // Accept all connections
            callback();
        },

        onMailFrom(address, session, callback) {
            // Log sender in development mode
            if (config.logger) {
                console.log(`SMTP: Mail from: ${address.address}`);
            }

            // Accept all senders
            callback();
        },

        onRcptTo(address, session, callback) {
            // Log recipient in development mode
            if (config.logger) {
                console.log(`SMTP: Mail to: ${address.address}`);
            }

            // Accept all recipients
            callback();
        }
    });

    // Start the server
    server.listen(config.port, config.host, () => {
        console.log(`SMTP server running on ${config.host}:${config.port} with authentication enabled`);
        console.log(`SMTP username: ${SMTP_AUTH.user} (Use this in your camera/device configuration)`);
    });

    // Handle errors
    server.on('error', (error) => {
        console.error('SMTP server error:', error);
    });

    return server;
}

/**
 * Process an email similarly to the existing IMAP logic
 * @param {Object} emailData - The parsed email data
 * @returns {Object} The processed event data
 */
function processEmail(emailData) {
    try {
        const { subject, date, messageId, attachments, html, authenticated, authenticatedUser } = emailData;

        // Check if this is an alarm email by subject
        if (subject.includes('Detected') || subject.includes('Alert') || subject.includes('Motion')) {
            console.log('SMTP: Found an alarm email:', subject);

            // Log authentication status
            if (authenticated) {
                console.log(`SMTP: Email was sent by authenticated user: ${authenticatedUser}`);
            } else {
                console.log('SMTP: Email was sent without authentication');
            }

            // Extract camera and event type from subject
            let camera = '';
            let eventType = '';

            if (subject.includes('from')) {
                camera = subject.split('from')[1].split('at')[0].trim();
            }

            if (subject.includes('Motion Detected')) {
                eventType = 'Motion Detected';
            } else if (subject.includes('Person Detected')) {
                eventType = 'Person Detected';
            } else if (subject.includes('Vehicle Detected')) {
                eventType = 'Vehicle Detected';
            } else {
                eventType = 'Alert';
            }

            // Handle image - either from attachments or embedded in HTML
            let imagePath = '';
            let imageContent = null;

            // First check attachments
            if (attachments && attachments.length > 0) {
                for (const attachment of attachments) {
                    if (attachment.contentType && attachment.contentType.includes('image')) {
                        const timestamp = Date.now();
                        const imgFileName = `${timestamp}_${attachment.filename.replace(/[^a-zA-Z0-9_.]/g, '')}`;
                        imagePath = `/images/${imgFileName}`;
                        imageContent = attachment.content;
                        break;
                    }
                }
            }
            // If no attachments, try extracting from HTML
            else if (html) {
                const imgRegex = /<img.+?src=["'](.+?)["'].*?>/ig;
                const imgMatch = imgRegex.exec(html);

                if (imgMatch && imgMatch[1]) {
                    // For embedded images, we'll return the URL for later download
                    const imgUrl = imgMatch[1];
                    const timestamp = Date.now();
                    const imgFileName = `${timestamp}_embedded.jpg`;
                    imagePath = `/images/${imgFileName}`;
                    // Signal that this is a URL to be downloaded, not binary content
                    imageContent = { isUrl: true, url: imgUrl };
                }
            }

            // Return the processed event data
            return {
                date: date,
                subject,
                messageId,
                camera,
                eventType,
                device: camera,
                imagePath,
                imageContent,
                authenticated,
                authenticatedUser,
                acknowledged: false
            };
        }

        // Not an alarm email
        return null;
    } catch (error) {
        console.error('Error processing email in SMTP server:', error);
        return null;
    }
}

module.exports = {
    initSmtpServer,
    processEmail
};