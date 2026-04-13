import { Card, Typography } from 'antd';

const Home: React.FC = () => {
  return (
    <div style={{ maxWidth: 640, margin: '64px auto', padding: '0 16px' }}>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          BrightSmile Frontend
        </Typography.Title>
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          这是一个极简的 Ant Design Pro 单页面。
        </Typography.Paragraph>
      </Card>
    </div>
  );
};

export default Home;
