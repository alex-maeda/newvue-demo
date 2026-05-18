import React from 'react';
import { Link } from 'react-router-dom';

const PageNotFound: React.FunctionComponent = () => {
  return (
    <div className="page404">
      <div className="title">404</div>
      <div className="text">Page not found</div>
      <Link to="/" className="rs-btn">
        Home Page
      </Link>
    </div>
  );
};

export default PageNotFound;
