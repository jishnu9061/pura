import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { createInterface } from 'readline';
// Password strength validation
function validatePassword(password) {
    const errors = [];
    if (password.length < 8) {
        errors.push('Password must be at least 8 characters long');
    }
    if (password.length > 128) {
        errors.push('Password must be less than 128 characters');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\?]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }
    return { valid: errors.length === 0, errors };
}
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
async function promptInput(question, hidden = false) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        if (hidden) {
            // Hide password input
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
            rl.stdoutMuted = true;
            rl._writeToOutput = function _writeToOutput(stringToWrite) {
                if (rl.stdoutMuted) {
                    rl.output.write('*');
                }
                else {
                    rl.output.write(stringToWrite);
                }
            };
        }
        else {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
        }
    });
}
async function main() {
    console.log('🔐 Purayida Krishi Admin Credentials Update');
    console.log('==========================================\n');
    try {
        // Get current admin user
        const currentAdmin = await prisma.user.findFirst({
            where: { role: 'ADMIN' }
        });
        if (currentAdmin) {
            console.log(`Current admin email: ${currentAdmin.email}\n`);
        }
        // Get new email
        let newEmail;
        while (true) {
            newEmail = await promptInput('Enter new admin email: ');
            if (validateEmail(newEmail)) {
                break;
            }
            console.log('❌ Invalid email format. Please try again.\n');
        }
        // Get new password
        let newPassword;
        while (true) {
            newPassword = await promptInput('Enter new admin password: ', true);
            console.log(''); // New line after hidden input
            const validation = validatePassword(newPassword);
            if (validation.valid) {
                break;
            }
            console.log('❌ Password does not meet requirements:');
            validation.errors.forEach(error => console.log(`   - ${error}`));
            console.log('');
        }
        // Confirm password
        const confirmPassword = await promptInput('Confirm new password: ', true);
        console.log(''); // New line after hidden input
        if (newPassword !== confirmPassword) {
            console.log('❌ Passwords do not match. Exiting.');
            process.exit(1);
        }
        // Hash the new password
        console.log('🔄 Hashing password...');
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        // Update or create admin user
        if (currentAdmin) {
            await prisma.user.update({
                where: { id: currentAdmin.id },
                data: {
                    email: newEmail,
                    password: hashedPassword,
                }
            });
            console.log('✅ Admin credentials updated successfully!');
        }
        else {
            await prisma.user.create({
                data: {
                    email: newEmail,
                    password: hashedPassword,
                    role: 'ADMIN'
                }
            });
            console.log('✅ Admin user created successfully!');
        }
        console.log(`\n📧 Admin email: ${newEmail}`);
        console.log('🔒 Password has been securely hashed and stored.');
        console.log('\n⚠️  Security reminders:');
        console.log('   - Keep your credentials secure');
        console.log('   - You will receive email notifications on login');
        console.log('   - Change your password regularly');
        console.log('   - Use a unique, strong password');
    }
    catch (error) {
        console.error('❌ Error updating admin credentials:', error);
        process.exit(1);
    }
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
