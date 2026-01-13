import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'

@Injectable()
export class EmailService {
	private readonly logger = new Logger(EmailService.name)
	private transporter: nodemailer.Transporter

	constructor(private configService: ConfigService) {
		const smtpHost = this.configService.get<string>('SMTP_HOST', 'smtp.mail.ru')
		const smtpPort = this.configService.get<number>('SMTP_PORT', 465)
		const smtpSecure = this.configService.get<boolean>('SMTP_SECURE', true)
		const smtpUser = this.configService.get<string>('SMTP_USER')
		const smtpPassword = this.configService.get<string>('SMTP_PASSWORD')
		
		this.logger.log(`Initializing EmailService with SMTP_HOST: ${smtpHost}, SMTP_PORT: ${smtpPort}, SMTP_SECURE: ${smtpSecure}`)
		this.logger.log(`SMTP_USER: ${smtpUser ? 'configured' : 'NOT CONFIGURED'}`)
		this.logger.log(`SMTP_PASSWORD: ${smtpPassword ? 'configured' : 'NOT CONFIGURED'}`)
		
		if (!smtpUser || !smtpPassword) {
			this.logger.warn('SMTP credentials not configured. Email sending will fail.')
		}
		
		const transportOptions: any = {
			host: smtpHost,
			port: smtpPort,
			secure: smtpSecure,
			auth: {
				user: smtpUser,
				pass: smtpPassword,
			},
		}
		
		// Для порта 587 (не secure) требуется TLS
		if (smtpPort === 587 && !smtpSecure) {
			transportOptions.requireTLS = true
			transportOptions.tls = {
				rejectUnauthorized: false
			}
		}
		
		// Для порта 465 (secure) также настраиваем TLS
		if (smtpSecure) {
			transportOptions.tls = {
				rejectUnauthorized: false
			}
		}
		
		this.transporter = nodemailer.createTransport(transportOptions)
	}

	async sendRegistrationEmail(email: string, password: string): Promise<void> {
		const smtpUser = this.configService.get<string>('SMTP_USER')
		const smtpFrom = this.configService.get<string>('SMTP_FROM', smtpUser)
		
		this.logger.log(`Sending registration email to ${email}`)
		this.logger.log(`From: ${smtpFrom}`)
		
		if (!smtpUser) {
			const error = 'SMTP_USER is not configured in environment variables'
			this.logger.error(error)
			throw new Error(error)
		}
		
		const mailOptions = {
			from: smtpFrom,
			to: email,
			subject: 'Регистрация в системе ПЭК 3PL',
			text: `Здравствуйте!

Ваш аккаунт в системе ПЭК 3PL был успешно создан.

Ваши учетные данные для входа:
Логин: ${email}
Пароль: ${password}

Пожалуйста, сохраните эти данные в безопасном месте.

После первого входа рекомендуется изменить пароль в настройках профиля.

С уважением,
Команда ПЭК 3PL`,
			html: `
				<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
					<h2 style="color: #333;">Здравствуйте!</h2>
					<p>Ваш аккаунт в системе ПЭК 3PL был успешно создан.</p>
					<div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
						<p style="margin: 5px 0;"><strong>Ваши учетные данные для входа:</strong></p>
						<p style="margin: 5px 0;">Логин: <strong>${email}</strong></p>
						<p style="margin: 5px 0;">Пароль: <strong>${password}</strong></p>
					</div>
					<p>Пожалуйста, сохраните эти данные в безопасном месте.</p>
					<p>После первого входа рекомендуется изменить пароль в настройках профиля.</p>
					<p style="margin-top: 30px;">С уважением,<br>Команда ПЭК 3PL</p>
				</div>
			`,
		}

		try {
			await this.transporter.sendMail(mailOptions)
			this.logger.log(`Registration email sent successfully to ${email}`)
		} catch (error) {
			this.logger.error(`Failed to send registration email to ${email}:`, error)
			throw error
		}
	}
}

