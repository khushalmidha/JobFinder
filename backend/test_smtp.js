const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const User = require('./models/User'); // Adjust path if needed
require('dotenv').config();

async function testLocalSMTP() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://khushalmidha:7H5qXGxJ03vfYt9A@cluster0.qyi5j.mongodb.net/jobfinder');
    console.log('Connected to DB');

    // Get the first user (assuming Khushal)
    const user = await User.findOne();
    if (!user || !user.smtpConfig || !user.smtpConfig.user || !user.smtpConfig.pass) {
      console.log('No SMTP config found for user in DB. Please make sure you saved it in Settings.');
      process.exit(1);
    }

    console.log(`Testing SMTP for user: ${user.smtpConfig.user}`);

    const transporter = nodemailer.createTransport({
      host: user.smtpConfig.host || 'smtp.gmail.com',
      port: user.smtpConfig.port || 465,
      secure: user.smtpConfig.port === 465,
      auth: {
        user: user.smtpConfig.user,
        pass: user.smtpConfig.pass,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    await transporter.verify();
    console.log('✅ SMTP Connection Successful! The password is correct and Gmail is allowing connections.');
  } catch (error) {
    console.error('❌ SMTP Connection Failed!');
    console.error(error.message);
    if (error.message.includes('Invalid login')) {
      console.error('--> Tip: You MUST use a 16-character Gmail App Password, NOT your normal Gmail password.');
    }
  } finally {
    mongoose.disconnect();
  }
}

testLocalSMTP();
