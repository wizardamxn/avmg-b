import multer from 'multer';
import path from 'path';
import fs from 'fs';

// 1. Ensure the uploads directory exists
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// 2. Configure the Storage Engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Tell Multer to drop the file here
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 3. The Naming Strategy: Timestamp + Original Name
    // This guarantees every single file name is unique
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const cleanName = file.originalname.replace(/\s+/g, '_'); // Replace spaces with underscores

    cb(null, `${uniqueSuffix}-${cleanName}`);
  }
});

// 4. Export the middleware, setting a 100MB file size limit for security
export const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB limit
});
