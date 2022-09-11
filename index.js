const mongo = require("mongodb").MongoClient
const url = 'mongodb+srv://okra_takehome:bHrZclVaxWkjwdM7@okra-takehome.nopar.mongodb.net/myFirstDatabase?retryWrites=true&w=majority'
const puppeteer = require("puppeteer");
; (async () => {
	const browser = await puppeteer.launch({ headless: false});
	const page = await browser.newPage();
	await page.setViewport({ width: 1200, height: 720 })
	await page.goto("https://bankof.okra.ng/register", { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('body nav a:last-child', { visible: true });
	await page.click('body nav a[href="/login"]');

	const loginDetails = {
		password: 'Password@123',
		otp: '12345',
		email: 'sams.adeyemo@gmail.com'
	}
	await page.type('#email', loginDetails.email);
	await page.type('#password', loginDetails.password);
	await page.click('button[type="submit"]');
	page.on('dialog', async dialog => {
		await dialog.accept();
		await page.waitForNavigation();
		await page.type('#otp', loginDetails.otp);
		await page.click('button[type="submit"]');
		await page.waitForNavigation();
		await page.bringToFront();

	});
	await page.waitForSelector('main > section > section', { visible: true });
	const customer = await page.evaluate(() => {
		const mainDiv = document.querySelector('main > div');
		const record = {};
		mainDiv.querySelectorAll('div > p').forEach(p => {
			const divP = p.firstChild.textContent.slice(0, -1).trim().toLowerCase();
			record[divP] = p.lastChild.textContent.trim();
		});
		return {
			divP: mainDiv.firstChild.textContent.split('Welcome back')[1].slice(0, -1),
			...record
		};
	});

	await page.waitForSelector('main > section > section', { visible: true });
	customer.accounts = await page.evaluate(customer => {
		const record = [];

		const sections = document.querySelectorAll('main > section > section');
		sections.forEach(section => {
			const accountName = section.querySelector('h3:first-of-type').innerHTML;
			const amount = section.querySelector('p:first-of-type').innerHTML;
			const ledgerBalance = section.querySelector('p:last-of-type').innerHTML;

			const viewAccount = section.querySelector('a:last-of-type');
			const url = viewAccount.getAttribute('href');
			const accountId = url.split('-')[1];

			record.push({
				customer_bvn: customer.bvn,
				accountName,
				account_balance: amount.split(' ')[1].trim(),
				currency: amount.split(' ')[0].trim(),
				ledgerBalance: ledgerBalance.split(' ')[1].trim(),
				accountId,
				url
			});
		}, customer);
		return record;
	}, customer);

	for (const account of customer.accounts) {

		await page.click(`a[href="${account.url}"]`);
		await page.waitForSelector('main > section > div > table', { visible: true });

		account.transactions = await page.evaluate((account, customer) => {
			const tables = document.querySelector('main > section > div > table:first-of-type');

			const headers = [];
			tables.querySelectorAll('thead > tr > th').forEach(th => {
				const n = th.innerHTML.trim().replaceAll(' ', '_').toLowerCase();
				if (n) {
					headers.push(n);
				}
			});
			const record = [];
			tables.querySelectorAll('tbody > tr').forEach(tr => {
				const tableData = {};
				tr.querySelectorAll('th, td').forEach((val, dat) => {
					tableData[headers[dat]] = val.innerHTML.trim();
				});

				if (Object.keys(tableData).length !== 0) {
					tableData.account_id = account.accountId;
					tableData.customer = customer.bvn;
					//console.log(tableData)
					record.push(tableData);
				}
			});
			//console.log(record)
			return record;
		}, account, customer);

		await page.goBack();
		await page.waitForSelector('main > section > section', { visible: true });
	}

	//Save to DB
	let db;
	const cus_accounts = customer.accounts;
	let cus_transaction = [];
	mongo.connect(
		url,
		{
			useNewUrlParser: true,
			useUnifiedTopology: true,
		},
		(err, client) => {
			if (err) {
				console.error(err)
				return
			}
			db = client.db("jobsTwo");
			; (async () => {

				//Create Auths
				let AuthCollectionName = 'auths';
				let i = 0;
				while ((await (await db.listCollections().toArray()).findIndex((item) => item.name === AuthCollectionName) !== -1) === true) {
					i = i + 1;
					AuthCollectionName = 'auths_' + i;
				}
				let authsTable = db.collection(AuthCollectionName);
				const createauthResp = await authsTable.insertOne(loginDetails);
				//console.log(createauthResp.insertedId.toString())
				//End Auth

				//Create Customer
				const customerDetails = {
					name: customer.name,
					address: customer.address,
					bvn: customer.bvn,
					phone: customer.phone,
					email: customer.email,
					auth_id: createauthResp.insertedId.toString()
				};
				let customerCollectionName = 'customers';
				let ii = 0;
				while ((await (await db.listCollections().toArray()).findIndex((item) => item.name === customerCollectionName) !== -1) === true) {
					ii = ii + 1;
					customerCollectionName = 'customers_' + ii;
				}
				let customersTable = db.collection(customerCollectionName);
				const createCustomerResp = await customersTable.insertOne(customerDetails);
				//console.log(createCustomerResp.insertedId.toString())
				//End Customer

				//Create accounts
				let transactionList = [];
				let customerAccountCollectionName = 'accounts';
				let iii = 0;
				while ((await (await db.listCollections().toArray()).findIndex((item) => item.name === customerAccountCollectionName) !== -1) === true) {
					iii = iii + 1;
					customerAccountCollectionName = 'accounts_' + iii;
				}
				let customersAccountTable = db.collection(customerAccountCollectionName);
				for (const account of customer.accounts) {
					let accountObj = {};
					accountObj.customer_bvn = account.customer_bvn;
					accountObj.accountName = account.accountName;
					accountObj.account_balance = account.account_balance;
					accountObj.currency = account.currency;
					accountObj.ledgerBalance = account.ledgerBalance;
					accountObj.accountId = account.accountId;
					accountObj.customer_id = createCustomerResp.insertedId.toString();
					const createCustomerAccountResp = await customersAccountTable.insertOne(accountObj);
					//console.log(createCustomerAccountResp.insertedId.toString())
					//Transactions List
					for (const trans of account.transactions) {
						let transactions = {};
						transactions.type = trans.type;
						transactions.cleared_date = trans.cleared_date;
						transactions.description = trans.description;
						transactions.amount = trans.amount;
						transactions.beneficiary = trans.beneficiary;
						transactions.sender = trans.sender;
						transactions.account_id = createCustomerAccountResp.insertedId.toString();
						transactionList.push(transactions);
					}
				}	
				//End accounts

				//Create Transactions
				let customerTransactionCollectionName = 'transactions';
				let iiii = 0;
				while ((await (await db.listCollections().toArray()).findIndex((item) => item.name === customerTransactionCollectionName) !== -1) === true) {
					iiii = iiii + 1;
					customerTransactionCollectionName = 'transactions_' + iiii;
				}
				let customersTransactionTable = db.collection(customerTransactionCollectionName);
				 await customersTransactionTable.insertMany(transactionList);
				//End Transactions

				await page.click('body nav div a:last-child');
				await page.waitForSelector('body nav a[href="/login"]', { visible: true });
				await browser.close();
				// console.log('customer')
				// console.log(customer);

			})()
		}
	)

})()

