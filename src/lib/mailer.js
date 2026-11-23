import nodemailer from "nodemailer";

/** True when SMTP is configured; that's also what turns on email verification. */
export const mailConfigured = () => Boolean(process.env.SMTP_HOST);

let smtp;

export const sendMail = (mail) => {
  const port = Number(process.env.SMTP_PORT || 465);
  smtp ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = TLS from the start; 587 upgrades with STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return smtp.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, ...mail });
};
