import { Request, Response } from "express";

export default async (req: Request, res: Response) => {
  console.log("Workflow notification event:", JSON.stringify(req.body));

  return res.status(200).json({
    success: true,
    message: "Workflow notification received"
  });
};
