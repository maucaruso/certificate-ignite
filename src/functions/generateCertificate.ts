import { APIGatewayProxyHandler } from "aws-lambda";
import { compile } from "handlebars";
import { join } from "path";
import { readFileSync } from "fs";
import dayjs from "dayjs";
import chromium from "chrome-aws-lambda";
import { S3 } from "aws-sdk";

import { document } from "../utils/dynamodbClient";

interface ICreateCertificate {
  id: string;
  name: string;
  grade: string;
}

interface ITemplate {
  id: string;
  name: string;
  grade: string;
  medal: string;
  date: string;
}

const compileTemplate = async (data: ITemplate) => {
  const filePath = join(process.cwd(), "src", "templates", "certificate.hbs");
  
  const html = readFileSync(filePath, "utf-8");
  
  return compile(html)(data);
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate;
  
  const response = await document.query({
    TableName: "users_certificate",
    KeyConditionExpression: "id = :id",
    ExpressionAttributeValues: {
      ":id": id
    }
  }).promise();
  
  const userAlreadyExists = await response.Items[0];
  
  if (!userAlreadyExists) {
    await document.put({
      TableName: "users_certificate",
      Item: {
        id,
        name,
        grade,
        created_at: new Date().getTime(),
      }
    }).promise();
  }
  
  const medalPath = join(process.cwd(), "src", "templates", "selo.png");
  const medal = readFileSync(medalPath, "base64");
    
  const data: ITemplate = {
    name,
    id,
    grade,
    date: dayjs().format("DD/MM/YYYY"),
    medal: medal
  }
  
  const content = await compileTemplate(data);
  
  const browser = await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: true,
    userDataDir: process.env.IS_OFFLINE ? '/dev/null' : undefined
  });
  
  const page = await browser.newPage();
  
  await page.setContent(content);
  
  const pdf = await page.pdf({
    format: "a4",
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true,
    path: process.env.IS_OFFLINE ? "./certificate.pdf" : null  
  });
  
  await browser.close();
  
  const s3 = new S3();
  
  await s3.putObject({
    Bucket: "certificatenodejsignite2023",
    Key: `${id}.pdf`,
    ACL: "public-read",
    Body: pdf,
    ContentType: "application/pdf"
  }).promise();

  return {
    statusCode: 201,
    body: JSON.stringify({
      message: "Certificado gerado com sucesso!",
      url: `https://certificatenodejsignite2023.s3.us-east-1.amazonaws.com/${id}.pdf`
    }),
  }
}