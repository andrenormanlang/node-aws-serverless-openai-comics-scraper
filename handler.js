export const hello = async (event, context) => {
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Go Serverless v1.0! ${(await message({ time: 1, copy: 'Your function executed successfully!'}))}`,
      }),
    };
  };