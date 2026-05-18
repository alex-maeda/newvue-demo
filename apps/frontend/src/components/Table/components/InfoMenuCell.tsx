import { FC, MouseEvent, useState } from 'react';
// MODELS
import { IPatient } from '../../../models/Patient';
// REDUX
import InfoMenu from '../../InfoMenu';
import { useAppDispatch, useAppSelector } from '../../../hooks/hooks';
import { setMenuProps } from '../../../redux/reducers/menuReducer';
import { setSelectedPatientFromWorklist } from '../../../redux/reducers/followUpReducer';

const InfoMenuCell: FC<{ info: IPatient; disable: boolean }> = ({
  info,
  disable,
}) => {
  const [isMenuOpen, setMenuOpen] = useState<boolean>(false);
  const dispatch = useAppDispatch();
  const { isKonicaBranding } = useAppSelector(({ utils }) => utils);

  const clickHandler = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dispatch(setSelectedPatientFromWorklist(info));

    if (disable) {
      return;
    }

    dispatch(
      setMenuProps({
        info,
      }),
    );
    setMenuOpen(true);
  };

  const closeMenu = () => {
    setMenuOpen(false);
  };

  return (
    <div role="presentation">
      <span
        className={`custom-btn-table${
          isKonicaBranding ? ' isKonicaBranding' : ''
        } inline-menu`}
        onClick={clickHandler}
        data-icon="table-button-icon"
      />
      {isMenuOpen && <InfoMenu closeMenu={closeMenu} />}
    </div>
  );
};

export default InfoMenuCell;
