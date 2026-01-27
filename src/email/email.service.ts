import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'
import * as fs from 'fs'
import * as path from 'path'

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

	async sendComplaintEmail(
		subject: string, 
		data: Record<string, any>, 
		to?: string, 
		filePath?: string
	): Promise<void> {
		const smtpUser = this.configService.get<string>('SMTP_USER')
		const smtpFrom = this.configService.get<string>('SMTP_FROM', smtpUser)
		const recipientEmail = to || 'claims-3pl@pecom.ru'
		
		this.logger.log(`Sending complaint email to ${recipientEmail}`)
		this.logger.log(`From: ${smtpFrom}`)
		this.logger.log(`Subject: ${subject}`)
		if (filePath) {
			this.logger.log(`Attachment: ${filePath}`)
		}
		
		if (!smtpUser) {
			const error = 'SMTP_USER is not configured in environment variables'
			this.logger.error(error)
			throw new Error(error)
		}

		// Маппинг названий полей на русский язык
		const fieldTranslations: Record<string, string> = {
			firstName: 'Имя',
			first_name: 'Имя',
			lastName: 'Фамилия',
			last_name: 'Фамилия',
			email: 'Email',
			phone: 'Телефон',
			position: 'Должность',
			description: 'Описание',
			complaintNumber: 'Номер претензии',
			complaint_number: 'Номер претензии',
			client: 'Клиент',
			branch: 'Филиал',
			creationDate: 'Дата создания',
			creation_date: 'Дата создания',
			complaintType: 'Тип претензии',
			complaint_type: 'Тип претензии',
			status: 'Статус',
			confirmation: 'Подтверждение',
			deadline: 'Крайний срок',
			completionDate: 'Дата завершения',
			completion_date: 'Дата завершения',
			clientTIN: 'ИНН клиента',
			client_tin: 'ИНН клиента',
		}

		// Формируем HTML таблицу с данными претензии
		const dataRows = Object.entries(data)
			.map(([key, value]) => {
				// Используем перевод из маппинга или форматируем ключ
				const formattedKey = fieldTranslations[key] || 
					fieldTranslations[key.toLowerCase()] ||
					key
						.replace(/([A-Z])/g, ' $1')
						.replace(/^./, str => str.toUpperCase())
						.replace(/_/g, ' ')
						.trim()
				const formattedValue = value !== null && value !== undefined ? String(value) : '-'
				return `
					<tr style="border-bottom: 1px solid #ddd;">
						<td style="padding: 10px; font-weight: bold; width: 200px; vertical-align: top;">${formattedKey}:</td>
						<td style="padding: 10px; vertical-align: top;">${formattedValue}</td>
					</tr>
				`
			})
			.join('')

		const mailOptions: any = {
			from: smtpFrom,
			to: recipientEmail,
			subject: subject,
			text: `Претензия\n\n${Object.entries(data)
				.map(([key, value]) => {
					const translatedKey = fieldTranslations[key] || 
						fieldTranslations[key.toLowerCase()] || 
						key
							.replace(/([A-Z])/g, ' $1')
							.replace(/^./, str => str.toUpperCase())
							.replace(/_/g, ' ')
							.trim()
					return `${translatedKey}: ${value !== null && value !== undefined ? value : '-'}`
				})
				.join('\n')}`,
			html: `
				<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
					<h2 style="color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px;">Претензия</h2>
					<table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
						<tbody>
							${dataRows}
						</tbody>
					</table>
					<p style="margin-top: 30px; color: #666; font-size: 12px;">Это письмо было отправлено автоматически из системы ПЭК 3PL.</p>
				</div>
			`,
		}

		// Добавляем вложение, если есть файл
		if (filePath) {
			if (fs.existsSync(filePath)) {
				const fileName = path.basename(filePath)
				mailOptions.attachments = [
					{
						path: filePath,
						filename: fileName,
					},
				]
			} else {
				this.logger.warn(`File not found: ${filePath}`)
			}
		}

		try {
			await this.transporter.sendMail(mailOptions)
			this.logger.log(`Complaint email sent successfully to ${recipientEmail}`)
		} catch (error) {
			this.logger.error(`Failed to send complaint email to ${recipientEmail}:`, error)
			throw error
		}
	}
}

