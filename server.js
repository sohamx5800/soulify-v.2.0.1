const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const moment = require('moment'); // For handling time data
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|webm|ogg|mp3|wav|m4a/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

const cleanupUserFiles = (userId) => {
  if (userFiles[userId]) {
    userFiles[userId].forEach(filePath => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error('Error deleting file:', error);
      }
    });
    delete userFiles[userId];
  }
};

// Middleware for parsing JSON and handling file uploads
app.use(express.json());

app.post('/upload', upload.single('media'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const userId = req.headers['user-id'] || 'anonymous';
    
    // Track file for cleanup
    if (!userFiles[userId]) {
      userFiles[userId] = [];
    }
    userFiles[userId].push(req.file.path);
    
    res.json({
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: `/uploads/${req.file.filename}`
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

let waitingUsers = [];
let activeChats = {};
let users = {};
let disconnectedUsers = {}; // Track disconnected users
let usernames = new Set(); // Track taken usernames
let userFiles = {}; // Track files uploaded by each user

// Custom URL routes (place before static middleware)
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/home', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/talk\\$dsw', (req, res) => {
  res.sendFile(__dirname + '/public/chat.html');
});

app.get('/admin$panel', (req, res) => {
  res.sendFile(__dirname + '/admin.html');
});

// Route to serve the admin page
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/admin.html');
});

// Route to serve the setup page
app.get('/setup', (req, res) => {
  res.sendFile(__dirname + '/public/setup.html');
});

// Username checking endpoint
app.post('/check-username', (req, res) => {
  const { username } = req.body;
  const available = !usernames.has(username.toLowerCase());
  res.json({ available });
});

// Route to serve user activity data
app.get('/user-activity', (req, res) => {
  res.json(Object.keys(disconnectedUsers).map(id => ({
    id,
    ...disconnectedUsers[id]
  })));
});

// Serve static files from the "public" directory (after custom routes)
app.use(express.static('public'));

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('A user connected');
  io.emit('updateOnlineUsers', io.engine.clientsCount); // Update online users

  // Log the connection time
  users[socket.id] = {
    connectTime: moment().format(),
    username: null,
  };

  socket.on('startChat', () => {
    if (waitingUsers.length > 0) {
      const partner = waitingUsers.shift();
      activeChats[socket.id] = partner;
      activeChats[partner] = socket.id;

      // Share usernames between partners
      const currentUserUsername = users[socket.id]?.username || 'Anonymous';
      const partnerUsername = users[partner]?.username || 'Anonymous';

      io.to(socket.id).emit('chatStarted', { partnerId: partner, partnerUsername: partnerUsername });
      io.to(partner).emit('chatStarted', { partnerId: socket.id, partnerUsername: currentUserUsername });
    } else {
      waitingUsers.push(socket.id);
      io.to(socket.id).emit('waiting');
    }
  });

  socket.on('chatMessage', (msg) => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('chatMessage', msg);
    }
  });

  socket.on('mediaMessage', (data) => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('mediaMessage', data);
    }
  });

  socket.on('voiceMessage', (data) => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('voiceMessage', data);
    }
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('offer', data);
    }
  });

  socket.on('answer', (data) => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('answer', data);
    }
  });

  socket.on('ice-candidate', (data) => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('ice-candidate', data);
    }
  });

  socket.on('toggle-video', (enabled) => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('partner-video-toggle', enabled);
    }
  });

  socket.on('toggle-audio', (enabled) => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('partner-audio-toggle', enabled);
    }
  });

  socket.on('typing', () => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('typing');
    }
  });

  socket.on('setUsername', (username) => {
    if (users[socket.id]) {
      users[socket.id].username = username;
    }
  });

  socket.on('endChat', () => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('chatEnded');
      delete activeChats[partner];
      waitingUsers.push(partner);
      if (waitingUsers.length > 1) {
        const [user1, user2] = waitingUsers.splice(0, 2);
        activeChats[user1] = user2;
        activeChats[user2] = user1;
        io.to(user1).emit('chatStarted', user2);
        io.to(user2).emit('chatStarted', user1);
      }
    }
    delete activeChats[socket.id];
    io.to(socket.id).emit('chatEnded');

    // Clean up user files
    cleanupUserFiles(socket.id);

    // Automatically connect to waiting user if available
    if (waitingUsers.length > 0) {
      const newPartner = waitingUsers.shift();
      activeChats[newPartner] = socket.id;
      activeChats[socket.id] = newPartner;

      io.to(socket.id).emit('chatStarted', newPartner);
      io.to(newPartner).emit('chatStarted', socket.id);
    }
  });

  socket.on('disconnect', () => {
    const partner = activeChats[socket.id];
    if (partner) {
      io.to(partner).emit('chatEnded');
      delete activeChats[partner];
    }
    waitingUsers = waitingUsers.filter((id) => id !== socket.id);

    // Clean up user files
    cleanupUserFiles(socket.id);

    // Log the disconnection time and calculate the duration
    const disconnectTime = moment();
    const connectTime = moment(users[socket.id]?.connectTime);
    const duration = connectTime ? moment.duration(disconnectTime.diff(connectTime)).asMinutes() : 0;

    // Save the user activity data
    if (users[socket.id]) {
      // Remove username from taken usernames if it was set
      if (users[socket.id].username) {
        usernames.delete(users[socket.id].username.toLowerCase());
      }
      
      users[socket.id].disconnectTime = disconnectTime.format();
      users[socket.id].duration = duration;

      // Move user data to disconnected users
      disconnectedUsers[socket.id] = users[socket.id];
      delete users[socket.id];
    }

    delete activeChats[socket.id];
    io.emit('updateOnlineUsers', io.engine.clientsCount); // Update online users
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${PORT}`);
});
